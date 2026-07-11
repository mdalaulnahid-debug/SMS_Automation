'use strict';

const { readFile, stat, createReadStream } = require('node:fs');
const { readFile: readFileAsync } = require('node:fs/promises');
const { join } = require('node:path');
const https = require('node:https');
const { AutomationStore } = require('./store');
const { OperatorQueue } = require('./queue');
const { SmsGatewayClient } = require('./smsGateway');
const { ManualReviewStore } = require('./manualReviewStore');
const settingsStore = require('./settingsStore');
const { OPERATORS } = require('./domain');
const {
  AutomationService,
  DEFAULT_SEND_CONFIRMATION_GRACE_MS,
  DEFAULT_DUPLICATE_REQUEST_WINDOW_MS
} = require('./service');
const { loadGatewayConfig, loadAuthConfig, loadTelegramConfig, loadMailConfig } = require('./config');
const { isAdmin, isValidGateway } = require('./auth');
const { getBackendUrls, getLanAddresses, getPreferredLanIp } = require('./network');
const { UserAuthStore, SESSION_TTL_MS, isWithinRegistrationWindow } = require('./userAuth');
const { serializeSessionCookie, clearSessionCookie, sessionTokenFromRequest } = require('./cookies');
const { parseRegistryWorkbook } = require('./personnelRegistry');
const { QuotaTracker } = require('./quota');
const { OtpStore } = require('./otp');
const { AnomalyDetector } = require('./anomalyDetector');
const mailer = require('./mailer');

// Sliding-window per-requester rate limiter.
// Admin API key requests are never rate-limited (id will be null/blank).
class RateLimiter {
  constructor(maxPerWindow = 30, windowMs = 60_000) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
    this.buckets = new Map();
    setInterval(() => this._prune(), 5 * 60_000).unref();
  }

  check(id) {
    if (!id) return true;
    const now = Date.now();
    const timestamps = (this.buckets.get(id) || []).filter((t) => now - t < this.windowMs);
    if (timestamps.length >= this.maxPerWindow) return false;
    timestamps.push(now);
    this.buckets.set(id, timestamps);
    return true;
  }

  _prune() {
    const cutoff = Date.now() - this.windowMs;
    for (const [id, ts] of this.buckets) {
      const rem = ts.filter((t) => t > cutoff);
      if (!rem.length) this.buckets.delete(id);
      else this.buckets.set(id, rem);
    }
  }
}

const requestRateLimiter = new RateLimiter(30, 60_000);
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

function decorateGatewayHealth(store) {
  const now = Date.now();
  return store.listGateways().map((gw) => {
    const lastSeenMs = gw.lastSeenAt ? new Date(gw.lastSeenAt).getTime() : 0;
    const online = gw.status === 'CONFIGURED' && now - lastSeenMs < ONLINE_THRESHOLD_MS;
    return { ...gw, online };
  });
}

function summarizeAlerts(store, requests, gateways, unmatched) {
  const pendingApprovals = requests.filter((r) => r.status === 'NEEDS_MANUAL_REVIEW').length;
  const failed = requests.filter((r) => ['FAILED', 'TIMEOUT'].includes(r.status)).length;
  const offlineGateways = gateways.filter((g) => !g.online && g.status !== 'MOCK').length;

  return {
    pendingApprovals,
    failedRequests: failed,
    unmatchedSms: unmatched.length,
    offlineGateways,
    total: pendingApprovals + failed + unmatched.length + offlineGateways
  };
}

function buildActivityFeed(store, requests, gateways) {
  const requestById = new Map(requests.map((r) => [r.requestId, r]));
  const events = [];

  store.smsOutbox.slice(-80).forEach((row) => {
    const request = requestById.get(row.requestId);
    events.push({
      id: row.id,
      type: ['FAILED', 'ERROR'].includes(row.sentStatus) || row.sendResult?.ok === false ? 'dispatch_failed' : 'dispatch_sent',
      severity: ['FAILED', 'ERROR'].includes(row.sentStatus) || row.sendResult?.ok === false ? 'critical' : 'info',
      occurredAt: row.sentAt || row.createdAt,
      operator: row.operator,
      gatewayId: row.gatewayId,
      title: ['FAILED', 'ERROR'].includes(row.sentStatus) || row.sendResult?.ok === false ? 'Dispatch failed' : 'Dispatch sent',
      summary: request ? `${request.requestType} ${request.payload}` : row.messageBody,
      meta: {
        requestId: row.requestId,
        destinationNumber: row.destinationNumber,
        sentStatus: row.sentStatus
      }
    });
  });

  store.smsInbox.slice(-80).forEach((row) => {
    events.push({
      id: row.id,
      type: row.matchedRequestId ? 'reply_received' : 'unmatched_sms',
      severity: row.matchedRequestId ? 'success' : 'warning',
      occurredAt: row.receivedAt,
      operator: store.operatorForGateway(row.gatewayId),
      gatewayId: row.gatewayId,
      title: row.matchedRequestId ? 'Reply received' : 'Unmatched SMS',
      summary: row.messageBody,
      meta: {
        requestId: row.matchedRequestId,
        senderNumber: row.senderNumber
      }
    });
  });

  store.auditLogs.slice(-120).forEach((row) => {
    const severity = /FAILED|TIMEOUT|UNAUTHORIZED/i.test(row.action)
      ? 'critical'
      : /APPROVED|POSTED|COMPLETED|REPLY/i.test(row.action)
        ? 'success'
        : 'info';
    events.push({
      id: row.id,
      type: 'audit',
      severity,
      occurredAt: row.timestamp,
      operator: null,
      gatewayId: row.details?.gatewayId || null,
      title: row.action.replaceAll('_', ' '),
      summary: row.requestId || row.actor || 'system',
      meta: {
        requestId: row.requestId,
        actor: row.actor
      }
    });
  });

  gateways
    .filter((g) => !g.online && g.status !== 'MOCK')
    .forEach((gateway) => {
      events.push({
        id: `offline-${gateway.id}`,
        type: 'gateway_offline',
        severity: 'critical',
        occurredAt: gateway.lastSeenAt,
        operator: gateway.operator,
        gatewayId: gateway.id,
        title: 'Gateway offline',
        summary: gateway.operatorName || gateway.id,
        meta: {
          lastSeenAt: gateway.lastSeenAt
        }
      });
    });

  return events
    .filter((event) => event.occurredAt)
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
    .slice(0, 120);
}

function buildAdminData(store, queue) {
  const requests = store.listRequests();
  const gateways = decorateGatewayHealth(store);
  const unmatched = store.smsInbox.filter((row) => !row.matchedRequestId && !row.analysis?.ignored);
  const now = Date.now();
  const delayedConfirmations = store.smsOutbox.filter((row) => {
    if (row.sentStatus === 'SENT' || row.sentStatus === 'FAILED') return false;
    const anchor = row.claimedAt || row.sentAt;
    return anchor && (now - new Date(anchor).getTime() > DEFAULT_SEND_CONFIRMATION_GRACE_MS);
  });
  const recentAmbiguousReplies = store.auditLogs.filter((row) => {
    return row.action === 'SMS_REPLY_AMBIGUOUS' && now - new Date(row.timestamp).getTime() < 24 * 60 * 60 * 1000;
  });
  const recentDuplicateBlocks = store.auditLogs.filter((row) => {
    return row.action === 'REQUEST_DUPLICATE_BLOCKED' && now - new Date(row.timestamp).getTime() < 24 * 60 * 60 * 1000;
  });
  const duplicateRiskGroups = store.listDuplicateRiskGroups(DEFAULT_DUPLICATE_REQUEST_WINDOW_MS);
  const recentChatMismatches = store.auditLogs.filter((row) => {
    return row.action === 'TELEGRAM_CHAT_MISMATCH' && now - new Date(row.timestamp).getTime() < 24 * 60 * 60 * 1000;
  });
  const recentUnauthorizedAttempts = store.auditLogs.filter((row) => {
    return row.action === 'TELEGRAM_UNAUTHORIZED_ATTEMPT' && now - new Date(row.timestamp).getTime() < 24 * 60 * 60 * 1000;
  });
  // Behavioral anomaly tripwire (security-hardening v1 §11) — soft review
  // items, same 24h-rolling-audit-log pattern as the other Telegram signals
  // above, not a new alert-count contributor (see summarizeAlerts) since
  // these are explicitly non-blocking and shouldn't read as "needs action".
  const recentAnomalyFlags = store.auditLogs.filter((row) => {
    return row.action === 'BEHAVIORAL_ANOMALY_FLAGGED' && now - new Date(row.timestamp).getTime() < 24 * 60 * 60 * 1000;
  });
  const alerts = summarizeAlerts(store, requests, gateways, unmatched);
  const activity = buildActivityFeed(store, requests, gateways);
  const today = new Date().toDateString();
  const pendingApprovals = requests.filter((r) => r.status === 'NEEDS_MANUAL_REVIEW');
  const failedRequests = requests.filter((r) => ['FAILED', 'TIMEOUT'].includes(r.status));
  const queueSnapshot = queue.snapshot().map((row) => ({
    ...row,
    delayedSendCount: delayedConfirmations.filter((item) => item.operator === row.operator).length
  }));

  return {
    generatedAt: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    alerts,
    queues: queueSnapshot,
    stats: {
      activeRequests: requests.filter((r) => ['RECEIVED', 'VALIDATED', 'QUEUED', 'SMS_SENT', 'WAITING_OPERATOR_REPLY', 'NEEDS_MANUAL_REVIEW'].includes(r.status)).length,
      pendingApprovals: pendingApprovals.length,
      failedOrTimedOut: failedRequests.length,
      unmatchedInbound: unmatched.length,
      onlineGateways: gateways.filter((g) => g.online).length,
      delayedConfirmations: delayedConfirmations.length,
      ambiguousReplies24h: recentAmbiguousReplies.length,
      duplicateRiskGroups: duplicateRiskGroups.length,
      telegramChatMismatches24h: recentChatMismatches.length,
      telegramUnauthorizedAttempts24h: recentUnauthorizedAttempts.length,
      behavioralAnomalies24h: recentAnomalyFlags.length,
      todayRequests: requests.filter((r) => new Date(r.createdAt).toDateString() === today).length,
      completedToday: requests.filter((r) => r.status === 'COMPLETED' && new Date(r.createdAt).toDateString() === today).length
    },
    diagnostics: {
      delayedConfirmations: delayedConfirmations.map((row) => ({
        outboxId: row.id,
        requestId: row.requestId,
        gatewayId: row.gatewayId,
        operator: row.operator,
        sentStatus: row.sentStatus,
        anchorAt: row.claimedAt || row.sentAt,
        waitMinutes: Math.round((now - new Date(row.claimedAt || row.sentAt).getTime()) / 60000)
      })),
      recentAmbiguousReplies: recentAmbiguousReplies.length,
      recentDuplicateBlocks: recentDuplicateBlocks.length,
      recentChatMismatches: recentChatMismatches.map((row) => ({
        chatId: row.details?.chatId,
        chatTitle: row.details?.chatTitle,
        configuredGroupChatId: row.details?.configuredGroupChatId,
        timestamp: row.timestamp
      })),
      recentUnauthorizedAttempts: recentUnauthorizedAttempts.map((row) => ({
        chatId: row.details?.chatId,
        chatType: row.details?.chatType,
        fromId: row.details?.fromId,
        fromName: row.details?.fromName,
        timestamp: row.timestamp
      })),
      recentAnomalyFlags: recentAnomalyFlags.map((row) => ({
        officerId: row.details?.officerId,
        telegramId: row.details?.telegramId,
        officerEmail: row.actor,
        flagType: row.details?.flagType,
        detail: row.details?.detail,
        requestId: row.requestId,
        timestamp: row.timestamp
      })),
      duplicateRiskGroups: duplicateRiskGroups.map((group) => ({
        requestType: group[0].requestType,
        payload: group[0].payload,
        operators: group[0].targetOperators || [group[0].operator],
        requestIds: group.map((request) => request.requestId),
        count: group.length,
        latestCreatedAt: group[0].createdAt
      }))
    },
    activity,
    gatewayHealth: gateways.map((gateway) => ({
      id: gateway.id,
      operator: gateway.operator,
      operatorName: gateway.operatorName,
      online: gateway.online,
      status: gateway.status,
      lastSeenAt: gateway.lastSeenAt,
      gatewayUrl: gateway.gatewayUrl,
      phoneNumber: gateway.phoneNumber || '',
      shortcode: gateway.shortcode || '',
      trustedSendersCount: (gateway.trustedSenders || []).length
    })),
    requests,
    replyDrafts: store.listReplyDrafts(),
    unmatched,
    auditLogs: store.auditLogs.slice(-250),
    smsOutbox: store.smsOutbox.slice(-120),
    smsInbox: store.smsInbox.slice(-120)
  };
}

// /api/ops/* has no admin auth (it's the public landing page's data source — see
// public/index.html). buildActivityFeed()'s summary/meta fields can carry raw SMS
// content (MSISDN, NID, IMEI, location, addresses) for the admin-authenticated audit
// view — e.g. UNAUTHORIZED_SMS_SEND stores a phone number in `requestId`, which then
// surfaces as an audit-type event's `summary`. Rather than enumerate which event types
// or audit actions happen to carry sensitive payloads (a list that's easy to miss one
// of, as that case proved), strip summary/meta unconditionally for every event type —
// the public feed only needs to show "something happened," never the payload.
function sanitizeActivityForPublicOps(activity) {
  return activity.map((event) => ({
    id: event.id,
    type: event.type,
    severity: event.severity,
    occurredAt: event.occurredAt,
    operator: event.operator,
    gatewayId: event.gatewayId,
    title: event.title
  }));
}

function buildOpsData(store, queue) {
  const admin = buildAdminData(store, queue);
  return {
    generatedAt: admin.generatedAt,
    alerts: admin.alerts,
    posture: {
      backendReachable: true,
      summary: admin.alerts.total
        ? `${admin.alerts.total} alert${admin.alerts.total === 1 ? '' : 's'} need attention`
        : 'All monitored surfaces nominal'
    },
    operators: admin.gatewayHealth.map((gateway) => ({
      operator: gateway.operator,
      operatorName: gateway.operatorName,
      online: gateway.online,
      state: gateway.status === 'MOCK' ? 'MOCK' : gateway.online ? 'ONLINE' : 'OFFLINE',
      gatewayId: gateway.id,
      lastSeenAt: gateway.lastSeenAt
    })),
    stats: admin.stats,
    queuePressure: admin.queues.map((queueRow) => ({
      operator: queueRow.operator,
      activeRequestId: queueRow.active?.requestId || null,
      waitingCount: queueRow.waiting.length
    })),
    activity: sanitizeActivityForPublicOps(admin.activity.slice(0, 40))
  };
}

// Fire-and-forget Telegram alert to the admin/watchdog chat when an unauthorized send is detected.
function sendTelegramWatchdogAlert(telegramConfig, { gatewayId, recipient, snippet }) {
  const botToken = telegramConfig.botToken;
  const chatId = telegramConfig.watchdogAlertChatId || null;
  if (!botToken || !chatId) return;
  const text = `⚠️ <b>UNAUTHORIZED SMS DETECTED</b>\n\nGateway: <code>${gatewayId}</code>\nRecipient: <code>${recipient}</code>\nMessage: "<i>${snippet}</i>"\n\nCheck the admin AUDIT tab immediately.`;
  const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${botToken}/sendMessage`,
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
  };
  const req = https.request(options, (res) => { res.resume(); });
  req.on('error', (err) => console.warn('[watchdog-alert] Telegram notify failed:', err.message));
  req.write(payload);
  req.end();
}

function createApp(options = {}) {
  const gatewayConfig = options.gatewayConfig || loadGatewayConfig();
  const authConfig = options.authConfig || loadAuthConfig();
  // Persist to a file DB by default (set DB_PATH to override, or '' / ':memory:' for ephemeral).
  const dbPath = options.dbPath !== undefined
    ? options.dbPath
    : (process.env.DB_PATH || join(__dirname, '..', 'data', 'automation.db'));
  const store = new AutomationStore(gatewayConfig, dbPath ? { dbPath } : {});
  const queue = new OperatorQueue(store);
  const smsGateway = new SmsGatewayClient(store, queue);
  const telegramConfig = options.telegramConfig || loadTelegramConfig();
  const autoApproveChannels = telegramConfig.autoApprove ? ['telegram'] : [];
  const manualReviewStore = options.manualReviewStore || new ManualReviewStore();
  const service = new AutomationService({
    store,
    queue,
    smsGateway,
    denyUnknownRequesters: authConfig.denyUnknownRequesters,
    autoApproveChannels,
    manualReviewStore,
    // userAuth is constructed further below in this function, but this predicate is
    // only ever called during request handling (long after createApp() returns), so
    // the closure sees it fully initialized by then.
    isAdminTelegramSender: (telegramId) => {
      const user = telegramId && userAuth.getUserByTelegramId(telegramId);
      return Boolean(user) && (user.role === 'admin' || user.role === 'super_admin') && user.status === 'active';
    }
  });

  // Per-officer request quota + OTP re-verification challenge (security-hardening
  // v1 §7) — in-memory, per-process, matching requestRateLimiter's scope; a
  // restart clears everyone's quota/challenge state, which is acceptable for a
  // defense whose job is slowing down an in-progress impersonation attempt, not
  // maintaining a long-lived ledger. Injectable so tests can control the clock.
  const quotaTracker = options.quotaTracker || new QuotaTracker();
  const otpStore = options.otpStore || new OtpStore();
  // Behavioral anomaly tripwire (security-hardening v1 §11) — a soft net
  // underneath the hard quota/OTP wall above; flags surface to admins as
  // review items (buildAdminData's stats/diagnostics below), never blocks
  // a request itself. Same in-memory, per-process, injectable-clock scope
  // as quotaTracker/otpStore.
  const anomalyDetector = options.anomalyDetector || new AnomalyDetector();

  // Restore the per-operator waiting lists from any persisted QUEUED requests.
  queue.rebuild();

  // Resume sending for requests that were queued (but not yet dispatched) before a restart.
  async function recover() {
    return smsGateway.dispatchAll();
  }

  const requireAdmin = (req, res) => {
    if (isAdmin(req, authConfig)) return true;
    // Also accept a session token whose role is admin or super_admin.
    const sessionToken = require('./auth').presentedToken(req);
    const session = sessionToken && userAuth.validateSession(sessionToken);
    if (session && (session.user.role === 'admin' || session.user.role === 'super_admin')) return true;
    json(res, 401, { error: 'Admin authentication required.' });
    return false;
  };

  // Stricter than requireAdmin — role must specifically be super_admin, for
  // actions the design doc reserves to that tier (registration approval,
  // registry/window management). The legacy shared key still satisfies this
  // for now, consistent with how it satisfies requireAdmin elsewhere; full
  // retirement of that key for human paths is a later, separate step.
  const requireSuperAdmin = (req, res) => {
    if (isAdmin(req, authConfig)) return true;
    const sessionToken = require('./auth').presentedToken(req);
    const session = sessionToken && userAuth.validateSession(sessionToken);
    if (session && session.user.role === 'super_admin') return true;
    json(res, 401, { error: 'Super-admin authentication required.' });
    return false;
  };

  // --- Shared admin key retirement (security-hardening v1 §10) ---
  // Verified at implementation time which callers actually present the legacy
  // key: the Telegram bridge (its own reporting/moderation endpoints) and the
  // Android Gateway + Android Admin apps (dashboard, overview/requests/replies/
  // unmatched/audit, settings, reply-drafts, requests reject/retry, gateway/*)
  // — grepped directly from android-gateway/*/src. The Android Admin App has no
  // session-login flow of its own, so requireAdmin/requireSuperAdmin above stay
  // exactly as they are (key-or-session) for every endpoint either Android app
  // calls — retiring the key there would break a real, currently-working human
  // tool with no replacement auth path. Session-only requirement below applies
  // only to endpoints confirmed to have zero Android app dependency: every
  // security-hardening-v1-introduced endpoint (Personnel Registry, registration
  // approval/window, ops dashboard) plus the pre-existing admin.html-only tools
  // (QR provisioning, users, audit export, unmatched-candidates, timeouts) —
  // admin.html already supports real session login today, so nothing human
  // actually loses access.
  const requireAdminSessionOnly = (req, res) => {
    const sessionToken = require('./auth').presentedToken(req);
    const session = sessionToken && userAuth.validateSession(sessionToken);
    if (session && (session.user.role === 'admin' || session.user.role === 'super_admin')) return true;
    json(res, 401, { error: 'Admin session login required.' });
    return false;
  };

  const requireSuperAdminSessionOnly = (req, res) => {
    const sessionToken = require('./auth').presentedToken(req);
    const session = sessionToken && userAuth.validateSession(sessionToken);
    if (session && session.user.role === 'super_admin') return true;
    json(res, 401, { error: 'Super-admin session login required.' });
    return false;
  };

  // For the Telegram bridge's own reporting/moderation endpoints — a human
  // session was never valid here (no human calls these URLs directly), so
  // this is the legacy key check under an honest name, not a behavior change.
  const requireMachine = (req, res) => {
    if (isAdmin(req, authConfig)) return true;
    json(res, 401, { error: 'Machine authentication required.' });
    return false;
  };

  // Page-level gate for browser navigation (GET /, GET /admin) — distinct from
  // requireAdmin/requireAnySession above, which respond with a JSON 401 and are
  // meant for fetch()/XHR API calls. A plain page navigation never carries an
  // Authorization/x-api-key header (browsers don't attach those to page loads,
  // only to explicit fetch/XHR calls) or the legacy admin key, so this checks the
  // session cookie set at login instead, and redirects rather than returning
  // JSON. This is the fix for the previous gap where / and /admin served their
  // HTML/JS unconditionally, before any auth check ran at all.
  function pageSession(req) {
    const token = sessionTokenFromRequest(req);
    if (!token) return null;
    return userAuth.validateSession(token);
  }

  function redirectTo(res, location) {
    res.writeHead(302, { location });
    res.end();
  }

  // Serves the page only if the session's role is in allowedRoles. Redirects to
  // /login.html if there's no valid session, or to / if there is one but the
  // role isn't allowed (e.g. an officer hitting /admin lands somewhere real,
  // not stuck in a login loop). Returns the session on success so callers that
  // need it (none yet) can reuse it without re-validating.
  function guardPage(req, res, allowedRoles) {
    const result = pageSession(req);
    if (!result) {
      redirectTo(res, '/login.html');
      return null;
    }
    if (!allowedRoles.includes(result.user.role)) {
      redirectTo(res, '/');
      return null;
    }
    return result;
  }

  // User accounts / login (officers + admins) — separate from the legacy single admin API key.
  const authDbPath = options.authDbPath !== undefined
    ? options.authDbPath
    : (process.env.AUTH_DB_PATH || join(__dirname, '..', 'data', 'auth.db'));
  const userAuth = options.userAuth || new UserAuthStore(authDbPath);
  const mailConfig = options.mailConfig || loadMailConfig();

  // Bridge file-based mail config into process.env so mailer.js's transport (which reads
  // GMAIL_USER/GMAIL_APP_PASSWORD/MAIL_FROM directly) picks it up without further plumbing.
  if (mailConfig.gmailUser && !process.env.GMAIL_USER) process.env.GMAIL_USER = mailConfig.gmailUser;
  if (mailConfig.gmailAppPassword && !process.env.GMAIL_APP_PASSWORD) process.env.GMAIL_APP_PASSWORD = mailConfig.gmailAppPassword;
  if (mailConfig.gmailUser && !process.env.MAIL_FROM) process.env.MAIL_FROM = mailConfig.gmailUser;

  // Super-admin bootstrap: create the founding super_admin account if none exists yet.
  if (options.bootstrapSuperAdmin !== false && mailConfig.superAdminEmail && mailConfig.superAdminPassword) {
    if (!userAuth.getUserByEmail(mailConfig.superAdminEmail)) {
      userAuth.createVerifiedUser({
        email: mailConfig.superAdminEmail,
        password: mailConfig.superAdminPassword,
        name: 'Super Admin',
        role: 'super_admin'
      });
    }
  }

  function requireSession(req, res) {
    const token = require('./auth').presentedToken(req);
    const result = userAuth.validateSession(token);
    if (!result) {
      json(res, 401, { error: 'Login required.' });
      return null;
    }
    return result;
  }

  // Quota + OTP re-verification gate (security-hardening v1 §7) — only
  // applies to a request whose Telegram sender is a linked, registered
  // officer; unlinked senders (unregistered, or a channel other than
  // Telegram) aren't this defense's concern and pass through untouched.
  // Returns null when the request may proceed, or a service.submitRequest-
  // shaped rejection ({ ok:false, errorCode, replyText }) when it must not.
  async function checkOfficerQuota(requesterId) {
    const officer = requesterId && userAuth.getUserByTelegramId(requesterId);
    if (!officer) return null;

    if (otpStore.hasActiveChallenge(officer.id)) {
      return {
        ok: false,
        errorCode: 'VERIFICATION_REQUIRED',
        replyText: 'You already have a pending re-verification code — check your email and reply here with it to continue.'
      };
    }

    const quota = quotaTracker.recordRequest(officer.id);
    if (!quota.requiresVerification) return null;

    const { code, throttled } = otpStore.issueCode(officer.id);
    if (throttled) {
      // The per-hour issuance cap tripped instead — never possible to reach
      // normally (issuing one code per quota breach, and the quota window is
      // hours long), but if it ever does, fail safe: block with a message
      // that doesn't imply a code is on its way when none was sent.
      store.audit('system', 'TELEGRAM_QUOTA_CHALLENGE_THROTTLED', null, { officerId: officer.id, telegramId: requesterId });
      return {
        ok: false,
        errorCode: 'VERIFICATION_REQUIRED',
        replyText: 'Too many re-verification codes requested recently. Contact an administrator.'
      };
    }

    store.audit('system', 'TELEGRAM_QUOTA_BREACH', null, { officerId: officer.id, telegramId: requesterId, email: officer.email });
    const { subject, html, text } = mailer.reVerificationCodeEmail(code);
    await mailer.sendMail({ to: officer.email, subject, html, text });

    return {
      ok: false,
      errorCode: 'VERIFICATION_REQUIRED',
      replyText: `You've reached your request limit. A verification code was sent to your registered email — reply here with it to continue.`
    };
  }

  // Behavioral anomaly tripwire (security-hardening v1 §11) — same
  // linked-officer-only scoping as checkOfficerQuota, but never blocks:
  // every flag is audit-logged for admin review, the response to the
  // bridge is untouched either way. Runs regardless of whether the request
  // parsed (an off-hours/burst/identity signal doesn't depend on the text
  // being well-formed), but only folds in requestType when it did.
  function checkBehavioralAnomaly(body, result) {
    const officer = body.requesterId && userAuth.getUserByTelegramId(body.requesterId);
    if (!officer) return;
    const flags = anomalyDetector.recordAndCheck(officer.id, {
      languageCode: body.languageCode || null,
      username: body.username || null,
      requestType: result.ok ? result.request.requestType : null
    });
    for (const flag of flags) {
      store.audit(officer.email, 'BEHAVIORAL_ANOMALY_FLAGGED', result.ok ? result.request.requestId : null, {
        officerId: officer.id,
        telegramId: body.requesterId,
        flagType: flag.type,
        detail: flag.detail
      });
    }
  }

  async function handle(req, res) {
    try {
      if (req.method === 'GET' && req.url === '/setup') {
        // Only available when no admin key is configured yet.
        if (authConfig.adminApiKey) return json(res, 403, { error: 'Already configured. Use the existing admin key.' });
        return serveFile(res, 'setup.html', 'text/html; charset=utf-8');
      }
      if (req.method === 'POST' && req.url === '/setup') {
        if (authConfig.adminApiKey) return json(res, 403, { error: 'Already configured.' });
        const body = await readJson(req);
        const key = String(body.adminApiKey || '').trim();
        if (key.length < 8) return json(res, 400, { error: 'Password must be at least 8 characters.' });
        const configPath = require('node:path').join(__dirname, '..', 'config', 'auth.json');
        const newConfig = { adminApiKey: key, requireGatewayAuth: false, denyUnknownRequesters: false };
        await require('node:fs/promises').writeFile(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
        authConfig.adminApiKey = key; // apply immediately without restart
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && req.url === '/') {
        if (!guardPage(req, res, ['officer', 'admin', 'super_admin'])) return undefined;
        return serveFile(res, 'index.html', 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/app.js') {
        return serveFile(res, 'app.js', 'text/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/shared.js') {
        return serveFile(res, 'shared.js', 'text/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/theme.css') {
        return serveFile(res, 'theme.css', 'text/css; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/admin') {
        if (!guardPage(req, res, ['admin', 'super_admin'])) return undefined;
        return serveFile(res, 'admin.html', 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/login.html') {
        return serveFile(res, 'login.html', 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/register.html') {
        return serveFile(res, 'register.html', 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/admin.js') {
        return serveFile(res, 'admin.js', 'text/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/assets/police-insignia.svg') {
        return serveFile(res, 'assets/police-insignia.svg', 'image/svg+xml; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/api/health') {
        const port = Number(process.env.PORT || 3000);
        const lanAddresses = getLanAddresses();
        const preferredLanIp = getPreferredLanIp();
        return json(res, 200, {
          ok: true,
          service: 'sms-telegram-automation',
          version: '0.1.0',
          port,
          preferredLanIp,
          lanAddresses: lanAddresses.map((entry) => entry.address),
          backendUrls: getBackendUrls(port)
        });
      }
      if (req.method === 'GET' && req.url === '/api/app/version') {
        // No auth — phones need to check this even before they've registered.
        const versionFile = join(__dirname, '..', 'public', 'app-version.json');
        return new Promise((resolve) => {
          readFile(versionFile, 'utf8', (err, data) => {
            if (err) return resolve(json(res, 404, { error: 'No app version published yet.' }));
            try {
              resolve(json(res, 200, JSON.parse(data)));
            } catch {
              resolve(json(res, 500, { error: 'Corrupt app-version.json' }));
            }
          });
        });
      }
      if (req.method === 'POST' && req.url === '/api/app/publish-apk') {
        if (!requireAdmin(req, res)) return undefined;
        const vc = parseInt(req.headers['x-version-code'] || '0', 10);
        const vn = req.headers['x-version-name'] || '';
        const notes = req.headers['x-release-notes'] || vn;
        if (!vc || !vn) return json(res, 400, { error: 'x-version-code and x-version-name headers required' });
        const apkFile = join(__dirname, '..', 'public', 'gateway-app.apk');
        const verFile = join(__dirname, '..', 'public', 'app-version.json');
        await new Promise((resolve, reject) => {
          const { createWriteStream } = require('node:fs');
          const out = createWriteStream(apkFile);
          req.pipe(out);
          out.on('finish', resolve);
          out.on('error', reject);
          req.on('error', reject);
        });
        const versionJson = JSON.stringify({ versionCode: vc, versionName: vn, releaseNotes: notes }, null, 2);
        await require('node:fs/promises').writeFile(verFile, versionJson, 'utf8');
        store.audit('admin', 'APP_UPDATE_PUBLISHED', null, { versionCode: vc, versionName: vn });
        return json(res, 200, { ok: true, versionCode: vc, versionName: vn });
      }
      if (req.method === 'GET' && req.url === '/api/app/apk') {
        // No auth required — phones need the APK before they have credentials configured
        const apkFile = join(__dirname, '..', 'public', 'gateway-app.apk');
        return new Promise((resolve) => {
          stat(apkFile, (err, s) => {
            if (err) return resolve(json(res, 404, { error: 'APK not published yet. Run scripts/publish-apk.ps1.' }));
            res.writeHead(200, {
              'content-type': 'application/vnd.android.package-archive',
              'content-length': s.size,
              'content-disposition': 'attachment; filename="gateway-app.apk"'
            });
            createReadStream(apkFile).pipe(res);
            resolve();
          });
        });
      }
      if (req.method === 'POST' && req.url === '/api/admin/generate-qr') {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        const body = await readJson(req);
        const { gwId, url, pin, secret } = body;
        if (!gwId || !url) return json(res, 400, { error: 'gwId and url required' });
        const payload = JSON.stringify({ v: 1, url, gwId, pin: pin || '', secret: secret || '' });
        try {
          const QRCode = require('qrcode');
          const dataUrl = await QRCode.toDataURL(payload, { width: 300, margin: 2 });
          return json(res, 200, { dataUrl, payload });
        } catch (err) {
          return json(res, 500, { error: `QR generation failed: ${err.message}` });
        }
      }

      if (req.method === 'GET' && req.url === '/api/gateways') {
        if (!requireAdmin(req, res)) return undefined;
        return json(res, 200, { gateways: decorateGatewayHealth(store) });
      }
      if (req.method === 'POST' && req.url === '/api/gateways/register') {
        const body = await readJson(req);
        if (!isAdmin(req, authConfig) && !isValidGateway(req, body.gatewayId, store, authConfig)) {
          return json(res, 401, { error: 'Invalid or missing gateway secret.' });
        }
        const gateway = store.registerGateway(body.gatewayId, {
          host: body.host || body.localIp,
          port: body.port,
          phoneNumber: body.phoneNumber || ''
        });
        return json(res, 200, {
          ok: true,
          gateway: {
            id: gateway.id,
            gatewayUrl: gateway.gatewayUrl,
            status: gateway.status,
            lastSeenAt: gateway.lastSeenAt
          }
        });
      }
      if (req.method === 'GET' && req.url === '/api/admin/settings') {
        if (!requireAdmin(req, res)) return undefined;
        return json(res, 200, {
          telegramGroupChatId: settingsStore.readTelegramGroupChatId(),
          operators: settingsStore.readOperatorContacts(),
          authorizedUsers: settingsStore.readAuthorizedUsers()
        });
      }
      if (req.method === 'POST' && req.url === '/api/admin/settings/authorized-users') {
        if (!requireAdmin(req, res)) return undefined;
        const body = await readJson(req);
        try {
          const user = settingsStore.writeAuthorizedUser(body.telegramUserId, body.name);
          store.audit('admin', 'SETTINGS_AUTHORIZED_USER_ADDED', null, user);
          return json(res, 200, {
            ok: true,
            ...user,
            note: 'Restart the Telegram bridge process for this to take effect (pm2 restart sms-bridge).'
          });
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
      }
      if (req.method === 'POST' && req.url === '/api/admin/settings/authorized-users/remove') {
        if (!requireAdmin(req, res)) return undefined;
        const body = await readJson(req);
        try {
          const telegramUserId = settingsStore.removeAuthorizedUser(body.telegramUserId);
          store.audit('admin', 'SETTINGS_AUTHORIZED_USER_REMOVED', null, { telegramUserId });
          return json(res, 200, {
            ok: true,
            telegramUserId,
            note: 'Restart the Telegram bridge process for this to take effect (pm2 restart sms-bridge).'
          });
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
      }
      if (req.method === 'POST' && req.url === '/api/admin/settings/telegram-group') {
        if (!requireAdmin(req, res)) return undefined;
        const body = await readJson(req);
        try {
          const groupChatId = settingsStore.writeTelegramGroupChatId(body.groupChatId);
          store.audit('admin', 'SETTINGS_TELEGRAM_GROUP_UPDATED', null, { groupChatId });
          return json(res, 200, {
            ok: true,
            groupChatId,
            note: 'Restart the Telegram bridge process for this to take effect (pm2 restart sms-bridge).'
          });
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
      }
      if (req.method === 'POST' && req.url === '/api/admin/settings/operator-contact') {
        if (!requireAdmin(req, res)) return undefined;
        const body = await readJson(req);
        const operatorKey = String(body.operator || '').toUpperCase();
        if (!OPERATORS[operatorKey]) return json(res, 400, { error: `Unknown operator: ${body.operator}` });
        try {
          const shortcode = settingsStore.writeOperatorShortcode(operatorKey, body.shortcode);
          store.updateGatewayShortcode(operatorKey, shortcode);
          store.audit('admin', 'SETTINGS_OPERATOR_CONTACT_UPDATED', null, { operator: operatorKey, shortcode });
          return json(res, 200, { ok: true, operator: operatorKey, shortcode });
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
      }
      if (req.method === 'GET' && req.url === '/api/admin/personnel-registry') {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        return json(res, 200, { records: userAuth.listRegistry(), count: userAuth.registrySize() });
      }
      if (req.method === 'POST' && req.url === '/api/admin/personnel-registry/import') {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        let buffer;
        try {
          buffer = await readBuffer(req);
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
        let records;
        try {
          records = parseRegistryWorkbook(buffer);
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
        if (records.length === 0) {
          return json(res, 400, { error: 'No valid records found in the uploaded sheet.' });
        }
        const actor = require('./auth').presentedToken(req);
        const session = actor && userAuth.validateSession(actor);
        const result = userAuth.replaceRegistry(records, session ? session.user.email : 'admin');
        store.audit(session ? session.user.email : 'admin', 'PERSONNEL_REGISTRY_IMPORTED', null, {
          count: result.count,
          importedAt: result.importedAt
        });
        return json(res, 200, { ok: true, ...result });
      }
      if (req.method === 'POST' && req.url === '/api/admin/personnel-registry/add') {
        // Stricter than the bulk import above (super_admin, not just admin) —
        // adding one officer between spreadsheet re-imports is a more
        // targeted, easier-to-fat-finger action than a full re-upload.
        if (!requireSuperAdminSessionOnly(req, res)) return undefined;
        const body = await readJson(req);
        const actor = require('./auth').presentedToken(req);
        const session = actor && userAuth.validateSession(actor);
        let record;
        try {
          record = userAuth.addRegistryRecord(body, session ? session.user.email : 'super_admin');
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
        store.audit(session ? session.user.email : 'super_admin', 'PERSONNEL_REGISTRY_RECORD_ADDED', null, {
          name: record.name, phone: record.phone, email: record.email
        });
        return json(res, 200, { ok: true, record });
      }
      if (req.method === 'GET' && req.url === '/api/admin/registrations/pending') {
        if (!requireSuperAdminSessionOnly(req, res)) return undefined;
        return json(res, 200, { registrations: userAuth.listPendingApprovals() });
      }
      if (req.method === 'POST' && req.url === '/api/admin/registrations/approve') {
        if (!requireSuperAdminSessionOnly(req, res)) return undefined;
        const body = await readJson(req);
        if (!body.userId) return json(res, 400, { error: 'userId is required' });
        try {
          const user = userAuth.approveRegistration(body.userId);
          store.audit('super-admin', 'REGISTRATION_APPROVED', null, { userId: user.id, email: user.email });
          return json(res, 200, { ok: true, user: { id: user.id, email: user.email, status: user.status } });
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
      }
      if (req.method === 'GET' && req.url === '/api/admin/settings/registration-window') {
        if (!requireSuperAdminSessionOnly(req, res)) return undefined;
        return json(res, 200, {
          registrationWindowEndsAt: authConfig.registrationWindowEndsAt,
          isOpen: isWithinRegistrationWindow(authConfig.registrationWindowEndsAt)
        });
      }
      if (req.method === 'POST' && req.url === '/api/admin/settings/registration-window') {
        if (!requireSuperAdminSessionOnly(req, res)) return undefined;
        const body = await readJson(req);
        try {
          const endsAt = settingsStore.writeRegistrationWindowEndsAt(body.endsAt);
          authConfig.registrationWindowEndsAt = endsAt; // apply immediately, no restart — same pattern as /setup
          store.audit('super-admin', 'REGISTRATION_WINDOW_UPDATED', null, { endsAt });
          return json(res, 200, { ok: true, registrationWindowEndsAt: endsAt });
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
      }
      if (req.method === 'POST' && req.url === '/api/telegram/chat-mismatch') {
        // Reported by the Telegram bridge process when it sees a message from a chat that
        // doesn't match its configured groupChatId — the exact failure mode that silently
        // broke intake on 2026-06-20 (config drift between the bridge's groupChatId and the
        // real group) until someone happened to check pm2 logs. Now audit-visible instead.
        if (!requireMachine(req, res)) return undefined;
        const body = await readJson(req);
        if (!body.chatId) return json(res, 400, { error: 'chatId required' });
        store.audit('telegram-bridge', 'TELEGRAM_CHAT_MISMATCH', null, {
          chatId: String(body.chatId),
          chatTitle: body.chatTitle || null,
          configuredGroupChatId: body.configuredGroupChatId || null
        });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && req.url === '/api/telegram/unauthorized-attempt') {
        // Reported by the Telegram bridge when a sender fails the authorizedUsers check —
        // group allowlist rejection, or any private DM (private chats are always
        // authorized-only, see telegram-bridge/bridge.js planIntake). Closes the gap where
        // this previously only ever produced a console log line in the bridge process.
        if (!requireMachine(req, res)) return undefined;
        const body = await readJson(req);
        if (!body.chatId || !body.fromId) return json(res, 400, { error: 'chatId and fromId required' });
        store.audit('telegram-bridge', 'TELEGRAM_UNAUTHORIZED_ATTEMPT', null, {
          chatId: String(body.chatId),
          chatType: body.chatType || null,
          fromId: String(body.fromId),
          fromName: body.fromName || null
        });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && req.url === '/api/dashboard') {
        if (!requireAdmin(req, res)) return undefined;
        // Single-sourced from buildAdminData (same computation as /api/admin/* and /api/ops/*)
        // so stats never drift between the Gateway App's embedded Control Center and every
        // other surface. `gateways` (secret/apiKey-redacted) is kept for backward compatibility
        // with existing clients that read it directly off this endpoint.
        return json(res, 200, {
          ...buildAdminData(store, queue),
          gateways: store.publicGateways()
        });
      }
      if (req.method === 'GET' && req.url === '/api/ops/overview') {
        // Tightened from requireAnySession to requireAdmin (security-hardening v1,
        // access-tier model §4): a Registered Officer session must never receive
        // fleet/queue operational data, even via a direct API call — the public
        // landing page no longer renders this for that tier, and the boundary
        // has to hold at the API too, not just in what the page happens to draw.
        if (!requireAdminSessionOnly(req, res)) return undefined;
        return json(res, 200, buildOpsData(store, queue));
      }
      if (req.method === 'GET' && req.url === '/api/ops/activity') {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        const ops = buildOpsData(store, queue);
        return json(res, 200, {
          generatedAt: ops.generatedAt,
          alerts: ops.alerts,
          activity: ops.activity
        });
      }
      if (req.method === 'GET' && req.url === '/api/ops/gateways') {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        const ops = buildOpsData(store, queue);
        return json(res, 200, {
          generatedAt: ops.generatedAt,
          operators: ops.operators,
          queuePressure: ops.queuePressure
        });
      }
      if (req.method === 'GET' && req.url === '/api/admin/overview') {
        if (!requireAdmin(req, res)) return undefined;
        const admin = buildAdminData(store, queue);
        return json(res, 200, {
          generatedAt: admin.generatedAt,
          environment: admin.environment,
          alerts: admin.alerts,
          stats: admin.stats,
          diagnostics: admin.diagnostics,
          gatewayHealth: admin.gatewayHealth,
          queues: admin.queues,
          activity: admin.activity.slice(0, 60)
        });
      }
      if (req.method === 'GET' && req.url === '/api/admin/requests') {
        if (!requireAdmin(req, res)) return undefined;
        const admin = buildAdminData(store, queue);
        return json(res, 200, { requests: admin.requests });
      }
      if (req.method === 'GET' && req.url === '/api/admin/replies') {
        if (!requireAdmin(req, res)) return undefined;
        const admin = buildAdminData(store, queue);
        return json(res, 200, { replyDrafts: admin.replyDrafts });
      }
      if (req.method === 'GET' && req.url === '/api/admin/unmatched') {
        if (!requireAdmin(req, res)) return undefined;
        const admin = buildAdminData(store, queue);
        return json(res, 200, { unmatched: admin.unmatched, requests: admin.requests });
      }
      if (req.method === 'GET' && req.url === '/api/admin/rejected-messages') {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        // Reads the FULL in-memory audit log, not the 250-row slice /api/admin/audit uses —
        // REQUEST_VALIDATION_FAILED is a small fraction of total audit volume (most of it is
        // SMS_INBOUND/SMS_REPLY_UNMATCHED noise), so a rejected message could otherwise be
        // pushed out of the visible window within an hour on a busy day, with no way to see
        // what was actually rejected short of querying the database directly.
        const rejected = store.auditLogs
          .filter((row) => row.action === 'REQUEST_VALIDATION_FAILED')
          .slice(-200)
          .reverse()
          .map((row) => ({
            timestamp: row.timestamp,
            requesterName: row.details?.requesterName || null,
            requesterId: row.details?.requesterId || null,
            chatId: row.details?.chatId || null,
            errorCode: row.details?.errorCode || null,
            rawText: row.details?.rawText || null
          }));
        return json(res, 200, { rejected });
      }
      if (req.method === 'GET' && req.url === '/api/admin/audit') {
        if (!requireAdmin(req, res)) return undefined;
        const admin = buildAdminData(store, queue);
        return json(res, 200, {
          auditLogs: admin.auditLogs,
          integrity: store.verifyAuditChain()
        });
      }
      if (req.method === 'POST' && req.url === '/api/requests') {
        const body = await readJson(req);
        // Requests may come from the dashboard/bridge (admin key) or an authenticated gateway phone.
        if (!isAdmin(req, authConfig) && !isValidGateway(req, body.gatewayId, store, authConfig)) {
          return json(res, 401, { error: 'Authentication required to submit requests.' });
        }
        // Per-requester rate limit: 30 requests per 60s. Admin key bypasses (id = blank).
        const rateLimitId = isAdmin(req, authConfig) ? null : body.requesterId;
        if (!requestRateLimiter.check(rateLimitId)) {
          return json(res, 429, { error: 'Too many requests. Please wait a moment before submitting again.' });
        }
        const quotaRejection = await checkOfficerQuota(body.requesterId);
        if (quotaRejection) {
          // Still fed to the tripwire — a quota-blocked burst is itself a
          // meaningful timing/volume signal, even with no requestType to report.
          checkBehavioralAnomaly(body, { ok: false });
          return json(res, 400, quotaRejection);
        }
        const result = await service.submitRequest(body);
        checkBehavioralAnomaly(body, result);
        return json(res, result.ok ? 201 : 400, result);
      }
      if (req.method === 'POST' && req.url === '/api/sms/inbound') {
        const body = await readJson(req);
        if (!isAdmin(req, authConfig) && !isValidGateway(req, body.gatewayId, store, authConfig)) {
          return json(res, 401, { error: 'Invalid or missing gateway secret.' });
        }
        const result = service.receiveSmsWebhook(body);
        return json(res, result.ok ? 200 : 202, result);
      }
      if (req.method === 'GET' && req.url.startsWith('/api/gateway/jobs')) {
        const gatewayId = new URL(req.url, 'http://x').searchParams.get('gatewayId');
        if (!isAdmin(req, authConfig) && !isValidGateway(req, gatewayId, store, authConfig)) {
          return json(res, 401, { error: 'Invalid or missing gateway secret.' });
        }
        if (!gatewayId) return json(res, 400, { error: 'gatewayId required' });
        // Update last-seen so health dashboard shows ONLINE
        store.registerGatewayHeartbeat(gatewayId);
        const jobs = store.claimPendingJobs(gatewayId).map((row) => ({
          outboxId: row.id,
          to: row.destinationNumber,
          message: row.messageBody,
          requestId: row.requestId,
          operator: row.operator
        }));
        // Piggyback any pending admin commands (e.g. live phone-inbox dump requests).
        const commands = store.takePendingCommands(gatewayId);
        return json(res, 200, { jobs, commands });
      }
      // Gateway posts back its phone SMS inbox snapshot in response to a DUMP_INBOX command.
      if (req.method === 'POST' && req.url === '/api/gateway/inbox-dump') {
        const body = await readJson(req);
        if (!isAdmin(req, authConfig) && !isValidGateway(req, body.gatewayId, store, authConfig)) {
          return json(res, 401, { error: 'Invalid or missing gateway secret.' });
        }
        if (!body.gatewayId) return json(res, 400, { error: 'gatewayId required' });
        store.registerGatewayHeartbeat(body.gatewayId);
        const dump = store.saveInboxDump(body.gatewayId, body.messages || [], { commandId: body.commandId || null });
        return json(res, 200, { ok: true, receivedAt: dump.receivedAt, count: dump.messages.length });
      }
      // Admin: request a live inbox dump from a gateway phone.
      if (req.method === 'POST' && req.url.startsWith('/api/admin/gateways/') && req.url.endsWith('/request-inbox')) {
        if (!isAdmin(req, authConfig)) return json(res, 401, { error: 'Admin auth required.' });
        const gatewayId = decodeURIComponent(req.url.split('/')[4]);
        const body = await readJson(req).catch(() => ({}));
        const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
        const command = store.requestInboxDump(gatewayId, limit);
        return json(res, 200, { ok: true, command });
      }
      // Admin: fetch the latest inbox dump a gateway phone posted back.
      if (req.method === 'GET' && req.url.startsWith('/api/admin/gateways/') && req.url.endsWith('/inbox')) {
        if (!isAdmin(req, authConfig)) return json(res, 401, { error: 'Admin auth required.' });
        const gatewayId = decodeURIComponent(req.url.split('/')[4]);
        return json(res, 200, { dump: store.getInboxDump(gatewayId) });
      }
      if (req.method === 'POST' && req.url === '/api/gateway/heartbeat') {
        const body = await readJson(req);
        if (!isAdmin(req, authConfig) && !isValidGateway(req, body.gatewayId, store, authConfig)) {
          return json(res, 401, { error: 'Invalid or missing gateway secret.' });
        }
        if (!body.gatewayId) return json(res, 400, { error: 'gatewayId required' });
        store.registerGatewayHeartbeat(body.gatewayId);
        const gateway = store.getGateway(body.gatewayId);
        return json(res, 200, {
          ok: true,
          gateway: {
            id: gateway.id,
            lastSeenAt: gateway.lastSeenAt
          }
        });
      }
      if (req.method === 'POST' && req.url.startsWith('/api/gateway/jobs/') && req.url.endsWith('/ack')) {
        const outboxId = req.url.split('/')[4];
        const body = await readJson(req);
        if (!isAdmin(req, authConfig) && !isValidGateway(req, body.gatewayId, store, authConfig)) {
          return json(res, 401, { error: 'Invalid or missing gateway secret.' });
        }
        const job = store.ackOutboxJob(outboxId, {
          ok: body.ok,
          error: body.error,
          providerMessageId: body.providerMessageId
        });
        if (!job) return json(res, 404, { error: 'Job not found' });
        return json(res, 200, { ok: true, sentStatus: job.sentStatus });
      }
      if (req.method === 'POST' && req.url === '/api/sms/delivery') {
        const body = await readJson(req);
        if (!isAdmin(req, authConfig) && !isValidGateway(req, body.gatewayId, store, authConfig)) {
          return json(res, 401, { error: 'Invalid or missing gateway secret.' });
        }
        // { gatewayId, localId, requestId, operator, event, resultCode }
        const { gatewayId, localId, requestId, operator, event, resultCode } = body;
        store.audit('gateway', 'SMS_DELIVERY_STATUS', {
          gatewayId, localId, requestId, operator, event, resultCode
        });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && req.url === '/api/gateway/watchdog') {
        const body = await readJson(req);
        if (!isAdmin(req, authConfig) && !isValidGateway(req, body.gatewayId, store, authConfig)) {
          return json(res, 401, { error: 'Invalid or missing gateway secret.' });
        }
        const { gatewayId, recipient, messageSnippet } = body;
        console.warn(`[WATCHDOG] ⚠️  Unauthorized SMS from ${gatewayId} → ${recipient}: "${messageSnippet}"`);
        store.audit('watchdog', 'UNAUTHORIZED_SMS_SEND', recipient, { gatewayId, snippet: messageSnippet });
        sendTelegramWatchdogAlert(telegramConfig, { gatewayId, recipient, snippet: messageSnippet });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && req.url === '/api/users') {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        return json(res, 200, { users: store.listUsers() });
      }
      if (req.method === 'POST' && req.url === '/api/users') {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        const body = await readJson(req);
        if (!body.telegramId) return json(res, 400, { error: 'telegramId is required.' });
        const user = store.upsertUser({
          telegramId: body.telegramId,
          displayName: body.displayName,
          role: body.role,
          allowedOperators: body.allowedOperators,
          status: body.status
        });
        store.audit('admin', 'USER_UPSERTED', null, { telegramId: user.telegramId });
        return json(res, 200, { user });
      }
      if (req.method === 'POST' && req.url.startsWith('/api/users/') && req.url.endsWith('/status')) {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        const telegramId = decodeURIComponent(req.url.split('/').at(-2) || '');
        const body = await readJson(req);
        const user = store.setUserStatus(telegramId, body.status);
        store.audit('admin', 'USER_STATUS_CHANGED', null, { telegramId, status: body.status });
        return json(res, 200, { user });
      }
      if (req.method === 'GET' && req.url === '/api/audit/verify') {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        return json(res, 200, store.verifyAuditChain());
      }
      if (req.method === 'GET' && req.url === '/api/audit/export') {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        return csv(res, 'audit-log.csv', auditToCsv(store.auditLogs));
      }
      if (req.method === 'GET' && req.url.startsWith('/api/reply-drafts')) {
        if (!requireAdmin(req, res)) return undefined;
        const url = new URL(req.url, 'http://localhost');
        const status = url.searchParams.get('status') || undefined;
        return json(res, 200, { replyDrafts: store.listReplyDrafts({ status }) });
      }
      if (req.method === 'POST' && req.url.startsWith('/api/reply-drafts/')) {
        if (!requireAdmin(req, res)) return undefined;
        const id = decodeURIComponent(req.url.split('/').at(-2) || '');
        const action = req.url.split('/').at(-1);
        if (action === 'approve') {
          return json(res, 200, { request: await service.approveReply(id) });
        }
        if (action === 'posted') {
          const body = await readJson(req);
          return json(res, 200, {
            request: await service.markReplyPosted(id, { postedMessageId: body.postedMessageId })
          });
        }
        if (action === 'edited') {
          return json(res, 200, { request: await service.markReplyEdited(id) });
        }
        return json(res, 404, { error: 'Not found' });
      }
      if (req.method === 'POST' && req.url.startsWith('/api/requests/') && req.url.endsWith('/reject')) {
        if (!requireAdmin(req, res)) return undefined;
        const requestId = decodeURIComponent(req.url.split('/').at(-2) || '');
        const body = await readJson(req);
        const request = await service.rejectRequest(requestId, { reason: body.reason });
        return json(res, 200, { request });
      }
      if (req.method === 'POST' && req.url.startsWith('/api/requests/') && req.url.endsWith('/retry')) {
        if (!requireAdmin(req, res)) return undefined;
        const requestId = decodeURIComponent(req.url.split('/').at(-2) || '');
        const request = await service.retryRequest(requestId);
        return json(res, 200, { request });
      }
      if (req.method === 'POST' && req.url === '/api/manual-match') {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        const body = await readJson(req);
        if (!body.inboxId || !body.requestId) return json(res, 400, { error: 'inboxId and requestId required.' });
        const result = service.manualMatch(body.inboxId, body.requestId);
        return json(res, 200, result);
      }
      if (req.method === 'GET' && req.url.startsWith('/api/admin/unmatched/') && req.url.endsWith('/candidates')) {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        const inboxId = decodeURIComponent(req.url.split('/').at(-2) || '');
        const candidates = service.rankReplyCandidates(inboxId);
        return json(res, 200, { candidates });
      }
      if (req.method === 'POST' && req.url === '/api/admin/correct-match') {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        const body = await readJson(req);
        if (!body.inboxId || !body.requestId) return json(res, 400, { error: 'inboxId and requestId required.' });
        const result = service.correctMatch(body.inboxId, body.requestId);
        return json(res, 200, result);
      }
      if (req.method === 'GET' && req.url === '/api/sms/unmatched') {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        const unmatched = store.smsInbox.filter((row) => !row.matchedRequestId && !row.analysis?.ignored);
        return json(res, 200, { unmatched });
      }
      if (req.method === 'POST' && req.url === '/api/timeouts/run') {
        if (!requireAdminSessionOnly(req, res)) return undefined;
        return json(res, 200, { timedOut: await service.timeoutWaitingRequests() });
      }
      if (req.method === 'POST' && req.url === '/api/auth/register') {
        const body = await readJson(req);

        // Self-declared identity is never trusted (design doc §6) — phone and
        // email must both match the SAME Personnel Registry record. An admin
        // must have imported the registry before registration can succeed at
        // all; that's a deliberate consequence of "no registry match, no
        // account", not an oversight.
        const registry = userAuth.buildPersonnelRegistry();
        const match = registry.matchByPhoneAndEmail(body.phone, body.email);
        if (!match) {
          return json(res, 400, { error: 'Phone and email must match an official record in the Personnel Registry. Contact an administrator if you believe this is an error.' });
        }

        let telegramId = null;
        if (body.registrationToken) {
          try {
            telegramId = userAuth.consumeRegistrationToken(body.registrationToken);
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
        }

        let result;
        try {
          result = userAuth.register({
            email: body.email,
            password: body.password,
            name: body.name,
            phone: body.phone,
            designation: body.designation,
            unit: body.unit,
            role: 'officer',
            telegramId
          });
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
        const baseUrl = process.env.PUBLIC_BASE_URL || `http://${req.headers.host}`;
        const { subject, html, text } = mailer.verificationEmail(baseUrl, result.verifyToken);
        await mailer.sendMail({ to: result.email, subject, html, text });
        return json(res, 200, { ok: true, message: 'Registered. Check your email to verify your account.' });
      }
      if (req.method === 'POST' && req.url === '/api/telegram/registration-link') {
        // Called by the Telegram bridge (authenticated the same way as its other
        // reporting endpoints — the shared adminApiKey) when an unregistered
        // sender DMs the bot, so it can reply with a link to the web
        // registration form pre-bound to that Telegram identity.
        if (!requireMachine(req, res)) return undefined;
        const body = await readJson(req);
        if (!body.telegramId) return json(res, 400, { error: 'telegramId required' });
        const { token } = userAuth.createRegistrationToken(body.telegramId);
        const baseUrl = process.env.PUBLIC_BASE_URL || `http://${req.headers.host}`;
        return json(res, 200, { url: `${baseUrl}/register.html?token=${encodeURIComponent(token)}` });
      }
      if (req.method === 'POST' && req.url === '/api/telegram/verify-code') {
        // Called by the Telegram bridge when a private-DM sender replies with
        // what looks like a re-verification code (security-hardening v1 §7) —
        // same bridge-auth pattern as registration-link. Not tied to a specific
        // in-flight request; success just reopens the officer's quota window.
        if (!requireMachine(req, res)) return undefined;
        const body = await readJson(req);
        if (!body.telegramId || !body.code) return json(res, 400, { error: 'telegramId and code required' });
        const officer = userAuth.getUserByTelegramId(body.telegramId);
        if (!officer) return json(res, 200, { ok: false, reason: 'NO_ACTIVE_CHALLENGE' });

        const result = otpStore.verifyCode(officer.id, body.code);
        if (result.ok) {
          quotaTracker.resetAfterVerification(officer.id);
          store.audit('system', 'TELEGRAM_OTP_VERIFIED', null, { officerId: officer.id, telegramId: body.telegramId });
        } else {
          store.audit('system', 'TELEGRAM_OTP_FAILED', null, { officerId: officer.id, telegramId: body.telegramId, reason: result.reason });
        }
        return json(res, 200, result);
      }
      if (req.method === 'POST' && req.url === '/api/telegram/moderation-check') {
        // Checked fresh on every moderation-command attempt (security-hardening v1
        // §9) — the bridge never caches admin status, so a role change or account
        // disablement takes effect on the very next command, not after some
        // periodic refresh interval.
        if (!requireMachine(req, res)) return undefined;
        const body = await readJson(req);
        if (!body.telegramId) return json(res, 400, { error: 'telegramId required' });
        const user = userAuth.getUserByTelegramId(body.telegramId);
        const authorized = Boolean(user) && (user.role === 'admin' || user.role === 'super_admin') && user.status === 'active';
        return json(res, 200, { authorized, actorName: authorized ? user.name : null });
      }
      if (req.method === 'POST' && req.url === '/api/telegram/moderation-action') {
        // Reported by the bridge after it has already executed a moderation action
        // via the Telegram API (this backend holds no bot token and cannot perform
        // the action itself) — audit-only, per design doc §9's "every admin message
        // and moderation action is audit-logged" requirement.
        if (!requireMachine(req, res)) return undefined;
        const body = await readJson(req);
        if (!body.action || !body.actorTelegramId) return json(res, 400, { error: 'action and actorTelegramId required' });
        store.audit(body.actorName || body.actorTelegramId, 'TELEGRAM_MODERATION_ACTION', null, {
          action: body.action,
          actorTelegramId: body.actorTelegramId,
          targetTelegramId: body.targetTelegramId || null,
          targetName: body.targetName || null,
          chatId: body.chatId || null,
          durationMinutes: body.durationMinutes || null,
          success: Boolean(body.success),
          error: body.error || null
        });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && req.url.startsWith('/verify-email')) {
        const token = new URL(req.url, 'http://x').searchParams.get('token') || '';
        try {
          userAuth.verifyEmail(token, { registrationWindowEndsAt: authConfig.registrationWindowEndsAt });
          res.writeHead(302, { location: '/login.html?verified=1' });
          return res.end();
        } catch (error) {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
          return res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Verification failed</title></head><body style="font-family:sans-serif;padding:40px;color:#ccc;background:#08111f"><p style="color:#ff6d7f">${error.message}</p><p><a href="/login.html" style="color:#c7cbd4">Go to sign in</a></p></body></html>`);
        }
      }
      if (req.method === 'POST' && req.url === '/api/auth/login') {
        const body = await readJson(req);
        let result;
        try {
          result = userAuth.startLogin({ email: body.email, password: body.password });
        } catch (error) {
          return json(res, 401, { error: error.message });
        }
        const { subject, html, text } = mailer.mfaCodeEmail(result.mfaCode);
        await mailer.sendMail({ to: result.email, subject, html, text });
        return json(res, 200, { ok: true, pendingToken: result.pendingToken, message: 'Enter the code emailed to you.' });
      }
      if (req.method === 'POST' && req.url === '/api/auth/mfa/verify') {
        const body = await readJson(req);
        try {
          const result = userAuth.completeLogin({
            pendingToken: body.pendingToken,
            code: body.code,
            ip: req.socket?.remoteAddress,
            userAgent: req.headers['user-agent']
          });
          // Also set the session as a cookie — page navigations (GET /, GET /admin)
          // never carry the Authorization header the JSON `token` is used with, so
          // guardPage() needs this to enforce access on the initial HTML request.
          res.setHeader('Set-Cookie', serializeSessionCookie(result.token, { maxAgeSeconds: SESSION_TTL_MS / 1000 }));
          return json(res, 200, result);
        } catch (error) {
          return json(res, 401, { error: error.message });
        }
      }
      if (req.method === 'POST' && req.url === '/api/auth/logout') {
        const token = require('./auth').presentedToken(req);
        userAuth.logout(token);
        res.setHeader('Set-Cookie', clearSessionCookie());
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && req.url === '/api/auth/me') {
        const session = requireSession(req, res);
        if (!session) return undefined;
        // requireSession's user is the FULL auth_users row (password_hash,
        // verify_token, mfa_code_hash, ...) — safeUserFields() is the allowlist
        // that keeps this endpoint from leaking those to any logged-in client.
        return json(res, 200, { user: safeUserFields(session.user) });
      }
      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }

  return { handle, store, queue, smsGateway, service, recover, userAuth };
}

// APK download: accept any registered gateway's secret (not tied to a specific gatewayId).
function isValidGatewayHeader(req, store, authConfig) {
  const secret = req.headers['x-gateway-secret'] || '';
  if (!secret) return false;
  return store.listGateways().some((gw) => gw.secret && gw.secret === secret);
}

async function serveFile(res, fileName, contentType) {
  const content = await readFileAsync(join(__dirname, '..', 'public', fileName), 'utf8');
  res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(content);
}

// Allowlist for exposing an auth_users row to its own owner via /api/auth/me —
// the row itself carries password_hash, verify_token, mfa_code_hash, and
// pending_session_token, none of which any client should ever receive.
function safeUserFields(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone || null,
    designation: user.designation || null,
    unit: user.unit || null,
    role: user.role,
    status: user.status,
    telegramLinked: Boolean(user.telegram_id),
    createdAt: user.created_at
  };
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function csv(res, fileName, body) {
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${fileName}"`
  });
  res.end(body);
}

// Export the audit log (including the hash chain) as CSV for offline review / case records.
function auditToCsv(rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['id', 'timestamp', 'actor', 'action', 'requestId', 'details', 'prevHash', 'hash'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        esc(row.id),
        esc(row.timestamp),
        esc(row.actor),
        esc(row.action),
        esc(row.requestId),
        esc(JSON.stringify(row.details)),
        esc(row.prevHash),
        esc(row.hash)
      ].join(',')
    );
  }
  return lines.join('\r\n');
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

// Collects the raw request body as a Buffer, for binary uploads (the
// Personnel Registry .xlsx import) where JSON parsing doesn't apply. The
// client sends the file's raw bytes directly as the body (fetch() can POST
// a File/Blob that way) — no multipart parsing needed on the server, which
// this codebase has no existing precedent for.
function readBuffer(req, maxBytes = 5_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = { createApp };
