'use strict';

const {
  OPERATORS,
  STATUSES,
  DISPATCH_STATUSES,
  TERMINAL_DISPATCH_STATUSES,
  assertTransition,
  createRequestId,
  normalizePhoneNumber,
  normalizeSenderId
} = require('./domain');
const { createHash } = require('node:crypto');
const { Persistence } = require('./persistence');

function nowIso() {
  return new Date().toISOString();
}

const DUPLICATE_BLOCKING_STATUSES = Object.freeze([
  STATUSES.RECEIVED,
  STATUSES.VALIDATED,
  STATUSES.QUEUED,
  STATUSES.SMS_SENT,
  STATUSES.WAITING_OPERATOR_REPLY,
  STATUSES.REPLY_RECEIVED,
  STATUSES.NEEDS_MANUAL_REVIEW
]);

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

class AutomationStore {
  constructor(gatewayConfig = {}, options = {}) {
    this.sequence = 0;
    this.referenceSequence = 0;
    this.users = new Map();
    this.gateways = new Map();
    this.requests = new Map();
    this.smsOutbox = [];
    this.smsInbox = [];
    this.replyDrafts = [];
    this.auditLogs = [];
    this.lastAuditHash = '';
    // Persistence is opt-in: with no dbPath the store is pure in-memory (tests, ephemeral runs).
    this.persistence = options.dbPath ? new Persistence(options.dbPath) : null;

    Object.entries(OPERATORS).forEach(([operatorKey, operator]) => {
      const config = gatewayConfig[operatorKey] || {};
      this.gateways.set(operator.gatewayId, {
        id: operator.gatewayId,
        operator: operatorKey,
        operatorName: operator.name,
        shortcode: config.shortcode || operator.shortcode,
        gatewayUrl: config.gatewayUrl || '',
        sendPath: config.sendPath || '/send-sms',
        apiKey: config.apiKey || '',
        secret: config.secret || '',
        trustedSenders: config.trustedSenders?.length ? config.trustedSenders : operator.trustedSenders,
        status: config.gatewayUrl ? 'CONFIGURED' : 'MOCK',
        lastSeenAt: nowIso()
      });
    });

    if (this.persistence) this._restore();
  }

  // Load any persisted state into the in-memory working set on boot. Config-driven gateway
  // fields (trustedSenders/apiKey/sendPath) win over the DB so edits to gateways.json take
  // effect, but a runtime-registered gatewayUrl is restored so the phone need not re-register.
  _restore() {
    const data = this.persistence.loadAll();
    this.sequence = Number(data.meta.sequence || 0);
    this.referenceSequence = Number(data.meta.referenceSequence || 0);

    data.users.forEach((user) => this.users.set(user.telegramId, user));
    data.requests.forEach((request) => {
      request.dispatches = [];
      this.requests.set(request.requestId, request);
    });
    (data.dispatches || []).forEach((dispatch) => {
      const request = this.requests.get(dispatch.requestId);
      if (request) request.dispatches.push(dispatch);
    });
    this.smsOutbox = data.smsOutbox;
    this.smsInbox = data.smsInbox;
    this.replyDrafts = data.replyDrafts;
    this.auditLogs = data.auditLogs;
    // Resume the hash chain from the last persisted audit row.
    this.lastAuditHash = this.auditLogs.length ? this.auditLogs.at(-1).hash : '';

    data.gateways.forEach((saved) => {
      const gateway = this.gateways.get(saved.id);
      if (!gateway) return;
      if (saved.gatewayUrl) {
        gateway.gatewayUrl = saved.gatewayUrl;
        gateway.status = saved.status || 'CONFIGURED';
        gateway.lastSeenAt = saved.lastSeenAt || gateway.lastSeenAt;
        gateway.registeredAt = saved.registeredAt;
      }
    });

    // Seed/refresh the DB with the current gateway set (config + restored URLs).
    this.gateways.forEach((gateway) => this.persistence.upsertGateway(gateway));
  }

  close() {
    if (this.persistence) this.persistence.close();
  }

  upsertUser({ telegramId, displayName, role, allowedOperators, status }) {
    const existing = this.users.get(telegramId);
    const user = {
      id: existing?.id || randomId('user'),
      telegramId,
      displayName: displayName !== undefined ? displayName : existing?.displayName,
      role: role !== undefined ? role : (existing?.role ?? 'REQUESTER'),
      allowedOperators:
        allowedOperators !== undefined
          ? allowedOperators
          : (existing?.allowedOperators ?? Object.keys(OPERATORS)),
      // Preserve an explicitly set status (e.g. DISABLED) across resubmits; only new users default ACTIVE.
      status: status !== undefined ? status : (existing?.status ?? 'ACTIVE'),
      createdAt: existing?.createdAt || nowIso()
    };
    this.users.set(telegramId, user);
    if (this.persistence) this.persistence.upsertUser(user);
    return user;
  }

  getUser(telegramId) {
    return this.users.get(telegramId) || null;
  }

  listUsers() {
    return Array.from(this.users.values());
  }

  setUserStatus(telegramId, status) {
    const existing = this.users.get(telegramId);
    if (!existing) throw new Error(`User not found: ${telegramId}`);
    return this.upsertUser({ telegramId, status });
  }

  nextRequestId() {
    this.sequence += 1;
    if (this.persistence) this.persistence.setMeta('sequence', this.sequence);
    return createRequestId(new Date(), this.sequence);
  }

  nextSilentReference() {
    this.referenceSequence += 1;
    if (this.persistence) this.persistence.setMeta('referenceSequence', this.referenceSequence);
    return `SR${Date.now().toString(36).toUpperCase()}${String(this.referenceSequence).padStart(4, '0')}`;
  }

  createRequest(input) {
    const request = {
      id: randomId('request'),
      requestId: input.requestId || this.nextRequestId(),
      requesterId: input.requesterId,
      requesterName: input.requesterName,
      channel: input.channel || 'manual',
      chatId: input.chatId || null,
      sourceMessageId: input.sourceMessageId || null,
      operator: input.operator,
      targetOperators: input.targetOperators || [input.operator],
      requestType: input.requestType,
      payload: input.payload,
      silentReference: input.silentReference || this.nextSilentReference(),
      rawRequestText: input.rawRequestText,
      formattedSmsText: input.formattedSmsText || null,
      receivedOperators: [],
      status: STATUSES.RECEIVED,
      createdAt: nowIso(),
      completedAt: null,
      failedReason: null,
      testDestination: input.testDestination ? normalizePhoneNumber(input.testDestination) : null
    };
    // One dispatch row per target operator — the per-operator unit of work for fan-out requests.
    request.dispatches = (request.targetOperators || [request.operator]).map((operatorKey) => ({
      id: randomId('dispatch'),
      requestId: request.requestId,
      operator: operatorKey,
      gatewayId: OPERATORS[operatorKey].gatewayId,
      status: DISPATCH_STATUSES.QUEUED,
      outboxId: null,
      inboxId: null,
      sentAt: null,
      repliedAt: null
    }));
    this.requests.set(request.requestId, request);
    if (this.persistence) {
      this.persistence.upsertRequest(request);
      request.dispatches.forEach((d) => this.persistence.upsertDispatch(d));
    }
    this.audit('system', 'REQUEST_RECEIVED', request.requestId, input);
    return request;
  }

  getDispatch(requestId, operatorKey) {
    const request = this.getRequest(requestId);
    return (request.dispatches || []).find((d) => d.operator === operatorKey) || null;
  }

  // Record that the operator SMS left the gateway (or failed to). Drives the per-operator
  // dispatch state used to derive request status and per-dispatch timeouts.
  setDispatchSent(requestId, operatorKey, { outboxId, ok }) {
    const dispatch = this.getDispatch(requestId, operatorKey);
    if (!dispatch) return null;
    dispatch.status = ok ? DISPATCH_STATUSES.WAITING_REPLY : DISPATCH_STATUSES.FAILED;
    dispatch.outboxId = outboxId || null;
    dispatch.sentAt = nowIso();
    if (this.persistence) this.persistence.upsertDispatch(dispatch);
    return dispatch;
  }

  markDispatchReplied(requestId, operatorKey, { inboxId } = {}) {
    const dispatch = this.getDispatch(requestId, operatorKey);
    if (!dispatch) return null;
    dispatch.status = DISPATCH_STATUSES.REPLY_RECEIVED;
    dispatch.inboxId = inboxId || dispatch.inboxId || null;
    dispatch.repliedAt = nowIso();
    if (this.persistence) this.persistence.upsertDispatch(dispatch);
    return dispatch;
  }

  markDispatchTimeout(requestId, operatorKey) {
    const dispatch = this.getDispatch(requestId, operatorKey);
    if (!dispatch) return null;
    dispatch.status = DISPATCH_STATUSES.TIMEOUT;
    if (this.persistence) this.persistence.upsertDispatch(dispatch);
    return dispatch;
  }

  allDispatchesTerminal(requestId) {
    const request = this.getRequest(requestId);
    const dispatches = request.dispatches || [];
    return dispatches.length > 0 && dispatches.every((d) => TERMINAL_DISPATCH_STATUSES.includes(d.status));
  }

  anyDispatchReplied(requestId) {
    const request = this.getRequest(requestId);
    return (request.dispatches || []).some((d) => d.status === DISPATCH_STATUSES.REPLY_RECEIVED);
  }

  updateRequestStatus(requestId, nextStatus, details = {}) {
    const request = this.getRequest(requestId);
    assertTransition(request.status, nextStatus);
    request.status = nextStatus;
    if ([STATUSES.COMPLETED, STATUSES.FAILED, STATUSES.TIMEOUT].includes(nextStatus)) {
      request.completedAt = nowIso();
    }
    if (details.failedReason) request.failedReason = details.failedReason;
    if (this.persistence) this.persistence.upsertRequest(request);
    this.audit('system', `REQUEST_${nextStatus}`, requestId, details);
    return request;
  }

  setFormattedSms(requestId, message) {
    const request = this.getRequest(requestId);
    request.formattedSmsText = message;
    if (this.persistence) this.persistence.upsertRequest(request);
    return request;
  }

  addSmsOutbox(entry) {
    const row = {
      id: randomId('outbox'),
      requestId: entry.requestId,
      gatewayId: entry.gatewayId,
      operator: entry.operator,
      silentReference: entry.silentReference,
      destinationNumber: entry.destinationNumber,
      messageBody: entry.messageBody,
      sentStatus: entry.sentStatus,
      sendResult: entry.sendResult || null,
      sentAt: entry.sentAt || nowIso()
    };
    this.smsOutbox.push(row);
    if (this.persistence) this.persistence.insertOutbox(row);
    this.audit('sms-gateway', 'SMS_OUTBOUND', entry.requestId, row);
    return row;
  }

  addSmsInbox(entry) {
    const row = {
      id: randomId('inbox'),
      gatewayId: entry.gatewayId,
      senderNumber: entry.senderNumber,
      messageBody: entry.messageBody,
      matchedRequestId: entry.matchedRequestId || null,
      analysis: entry.analysis || null,
      receivedAt: entry.receivedAt || nowIso()
    };
    this.smsInbox.push(row);
    if (this.persistence) this.persistence.insertInbox(row);
    this.audit('sms-gateway', 'SMS_INBOUND', row.matchedRequestId, row);
    return row;
  }

  findInboundDuplicate({ gatewayId, senderNumber, messageBody, receivedAt }) {
    return this.smsInbox.find((row) => {
      return row.gatewayId === gatewayId
        && row.senderNumber === senderNumber
        && row.messageBody === messageBody
        && row.receivedAt === receivedAt;
    }) || null;
  }

  addReplyDraft(entry) {
    const row = {
      id: randomId('reply'),
      requestId: entry.requestId,
      replyText: entry.replyText,
      sentStatus: entry.sentStatus,
      // Routing metadata copied from the request so a posting bridge can act on the
      // draft alone (reply to sourceMessageId in chatId, tag the requester) without a join.
      channel: entry.channel || 'manual',
      chatId: entry.chatId || null,
      sourceMessageId: entry.sourceMessageId || null,
      requesterName: entry.requesterName || null,
      requesterId: entry.requesterId || null,
      postedMessageId: null,
      // holdUntil: epoch ms before which the bridge should not post this reply.
      // Used for the multi-op grace period (5s from first reply). Not persisted.
      holdUntil: entry.holdUntil || null,
      sentAt: entry.sentAt || nowIso()
    };
    this.replyDrafts.push(row);
    if (this.persistence) this.persistence.upsertReplyDraft(row);
    this.audit('operator', 'REPLY_DRAFTED', entry.requestId, row);
    return row;
  }

  // Mutate a draft (status, sentAt, postedMessageId) in-memory and write-through. Routing all
  // reply edits through here keeps the persisted copy in sync (service.js no longer mutates rows directly).
  updateReplyDraft(replyId, fields = {}) {
    const row = this.getReplyDraft(replyId);
    if (!row) throw new Error(`Reply draft not found: ${replyId}`);
    Object.assign(row, fields);
    if (this.persistence) this.persistence.upsertReplyDraft(row);
    return row;
  }

  listReplyDrafts({ status } = {}) {
    const rows = this.replyDrafts;
    return status ? rows.filter((row) => row.sentStatus === status) : [...rows];
  }

  getReplyDraft(replyId) {
    return this.replyDrafts.find((row) => row.id === replyId) || null;
  }

  getRequest(requestId) {
    const request = this.requests.get(requestId);
    if (!request) throw new Error(`Request not found: ${requestId}`);
    return request;
  }

  listRequests() {
    return Array.from(this.requests.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listGateways() {
    return Array.from(this.gateways.values());
  }

  // Atomically claim all PENDING_PICKUP jobs for a gateway and return them.
  claimPendingJobs(gatewayId) {
    const claimedAt = nowIso();
    const jobs = this.smsOutbox.filter(
      (row) => row.gatewayId === gatewayId && row.sentStatus === 'PENDING_PICKUP'
    );
    jobs.forEach((job) => {
      job.sentStatus = 'CLAIMED';
      job.claimedAt = claimedAt;
      if (this.persistence) this.persistence.updateOutboxStatus(job.id, 'CLAIMED', null, claimedAt);
    });
    return jobs;
  }

  // Reset any CLAIMED job that has not been ACKed within maxAgeMs (default 90s).
  // Guards against phones that crash or restart between claim and ACK.
  reclaimStaleClaimedJobs(maxAgeMs = 90_000) {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const stale = this.smsOutbox.filter(
      (row) => row.sentStatus === 'CLAIMED' && row.claimedAt && row.claimedAt < cutoff
    );
    stale.forEach((job) => {
      job.sentStatus = 'PENDING_PICKUP';
      job.claimedAt = null;
      if (this.persistence) this.persistence.updateOutboxStatus(job.id, 'PENDING_PICKUP', null, null);
      this.audit('system', 'SMS_JOB_RECLAIMED', job.requestId, {
        outboxId: job.id, gatewayId: job.gatewayId, reason: 'stale CLAIMED'
      });
    });
    return stale;
  }

  // Phone reports result for a claimed job.
  ackOutboxJob(outboxId, { ok, error, providerMessageId } = {}) {
    const job = this.smsOutbox.find((row) => row.id === outboxId);
    if (!job) return null;
    job.sentStatus = ok ? 'SENT' : 'FAILED';
    job.sendResult = {
      ok,
      error: error || null,
      providerMessageId: providerMessageId || null,
      mode: 'poll',
      confirmedAt: nowIso()
    };
    if (this.persistence) this.persistence.updateOutboxStatus(outboxId, job.sentStatus, job.sendResult);
    this.audit('sms-gateway', ok ? 'SMS_SENT_CONFIRMED' : 'SMS_SEND_FAILED', job.requestId, {
      outboxId, gatewayId: job.gatewayId, error: error || null
    });
    return job;
  }

  registerGatewayHeartbeat(gatewayId) {
    const gateway = this.gateways.get(gatewayId);
    if (!gateway) return;
    gateway.lastSeenAt = nowIso();
    if (this.persistence) this.persistence.upsertGateway(gateway);
  }

  registerGateway(gatewayId, input = {}) {
    const gateway = this.gateways.get(gatewayId);
    if (!gateway) throw new Error(`Gateway not configured: ${gatewayId}`);

    const host = String(input.host || input.localIp || '').trim();
    const port = Number(input.port || 8080);
    if (!host) throw new Error('host is required');
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('port must be between 1 and 65535');
    }

    gateway.gatewayUrl = `http://${host}:${port}`;
    gateway.status = 'CONFIGURED';
    gateway.lastSeenAt = nowIso();
    gateway.registeredAt = nowIso();
    if (input.phoneNumber) gateway.phoneNumber = String(input.phoneNumber).trim();
    if (this.persistence) this.persistence.upsertGateway(gateway);
    return gateway;
  }

  // Apply a shortcode override live (no restart needed for the backend itself — the bridge
  // process is separate and unaffected by this). The on-disk write-through that makes this
  // survive a backend restart is settingsStore.writeOperatorShortcode(), called by the caller
  // alongside this, not here — this method only updates the in-memory/persisted runtime state.
  updateGatewayShortcode(operatorKey, shortcode) {
    const operator = OPERATORS[String(operatorKey || '').toUpperCase()];
    if (!operator) throw new Error(`Unknown operator: ${operatorKey}`);
    const gateway = this.gateways.get(operator.gatewayId);
    gateway.shortcode = String(shortcode).trim();
    if (this.persistence) this.persistence.upsertGateway(gateway);
    return gateway;
  }

  getGatewayByOperator(operatorKey) {
    const operator = OPERATORS[operatorKey];
    if (!operator) throw new Error(`Unknown operator: ${operatorKey}`);
    const gateway = this.gateways.get(operator.gatewayId);
    if (!gateway) throw new Error(`Gateway not configured: ${operator.gatewayId}`);
    return gateway;
  }

  getGateway(gatewayId) {
    const gateway = this.gateways.get(gatewayId);
    if (!gateway) throw new Error(`Gateway not configured: ${gatewayId}`);
    return gateway;
  }

  operatorForGateway(gatewayId) {
    return this.gateways.get(gatewayId)?.operator || null;
  }

  isTrustedSenderForGateway(gatewayId, sender) {
    const gateway = this.gateways.get(gatewayId);
    if (!gateway) return false;
    const normalizedSender = normalizeSenderId(sender);
    return gateway.trustedSenders.some((trustedSender) => {
      return normalizedSender === normalizeSenderId(trustedSender);
    });
  }

  getOutboxForGateway(requestId, gatewayId) {
    return this.smsOutbox.find((row) => {
      return row.requestId === requestId && row.gatewayId === gatewayId && row.sentStatus !== 'FAILED';
    });
  }

  getOutboxById(outboxId) {
    return this.smsOutbox.find((row) => row.id === outboxId) || null;
  }

  findRecentDuplicateRequest({ requestType, payload, targetOperators, windowMs }) {
    const cutoff = Date.now() - windowMs;
    const sortedTargets = [...(targetOperators || [])].sort().join('|');
    return this.listRequests().find((request) => {
      if (!DUPLICATE_BLOCKING_STATUSES.includes(request.status)) return false;
      if (new Date(request.createdAt).getTime() < cutoff) return false;
      if (request.requestType !== requestType) return false;
      if (request.payload !== payload) return false;
      return [...(request.targetOperators || [])].sort().join('|') === sortedTargets;
    }) || null;
  }

  listDuplicateRiskGroups(windowMs = 30 * 60 * 1000) {
    const cutoff = Date.now() - windowMs;
    const groups = new Map();
    for (const request of this.listRequests()) {
      if (!DUPLICATE_BLOCKING_STATUSES.includes(request.status)) continue;
      if (new Date(request.createdAt).getTime() < cutoff) continue;
      const key = [
        request.requestType,
        request.payload,
        [...(request.targetOperators || [])].sort().join('|')
      ].join('::');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(request);
    }
    return [...groups.values()]
      .filter((group) => group.length > 1)
      .map((group) => group.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  findActiveRequestForGateway(gatewayId, senderNumber, windowMs, messageBody = '') {
    const reference = extractSilentReference(messageBody);
    if (reference) {
      // Silent reference: authoritative match — search all non-terminal statuses plus TIMEOUT
      // so replies that arrive after a timeout (e.g. phone was offline) are still captured.
      const byReference = this.listRequests().find((request) => {
        if (![
          STATUSES.WAITING_OPERATOR_REPLY,
          STATUSES.REPLY_RECEIVED,
          STATUSES.NEEDS_MANUAL_REVIEW,
          STATUSES.TIMEOUT
        ].includes(request.status)) {
          return false;
        }
        const sent = this.smsOutbox.find((row) => {
          return row.requestId === request.requestId && row.gatewayId === gatewayId;
        });
        return request.silentReference === reference && sent;
      });
      if (byReference) return byReference;
    }

    // Search active and recently-finalized requests. Also search TIMEOUT requests within
    // a 1-hour window — handles the case where the gateway phone was offline during the
    // reply window (WiFi/mobile transition), WorkManager retried after the timeout fired,
    // and the reply would otherwise be silently dropped as unmatched.
    const LATE_WINDOW_MS = 6 * 60 * 60 * 1000;   // 6h for WAITING / NEEDS_MANUAL_REVIEW
    const TIMEOUT_WINDOW_MS = 60 * 60 * 1000;     // 1h for TIMEOUT (offline-phone recovery)
    const now = Date.now();
    const lateThreshold = now - LATE_WINDOW_MS;
    const timeoutThreshold = now - TIMEOUT_WINDOW_MS;

    const pending = this.listRequests()
      .filter((request) => {
        if (request.status === STATUSES.TIMEOUT) {
          return new Date(request.createdAt).getTime() > timeoutThreshold;
        }
        return [STATUSES.WAITING_OPERATOR_REPLY, STATUSES.NEEDS_MANUAL_REVIEW].includes(request.status)
          && new Date(request.createdAt).getTime() > lateThreshold;
      })
      .filter((request) => {
        const sent = this.getOutboxForGateway(request.requestId, gatewayId);
        if (!sent) return false;
        const senderMatchesDestination =
          normalizePhoneNumber(sent.destinationNumber) === normalizePhoneNumber(senderNumber);
        const senderIsTrustedOperator = this.isTrustedSenderForGateway(gatewayId, senderNumber);
        return senderMatchesDestination || senderIsTrustedOperator;
      });

    if (pending.length === 1) return pending[0];
    if (pending.length > 1) return { ambiguous: true, candidates: pending };
    return null;
  }

  markOperatorReplyReceived(requestId, operatorKey) {
    const request = this.getRequest(requestId);
    if (!request.receivedOperators.includes(operatorKey)) {
      request.receivedOperators.push(operatorKey);
      if (this.persistence) this.persistence.upsertRequest(request);
    }
    return request;
  }

  // Append-only, tamper-evident audit log. Each row stores hash = sha256(prevHash + canonical(row)),
  // forming a chain: editing or deleting any past row breaks every subsequent hash, which
  // verifyAuditChain() detects. Important for a system whose output may support investigations.
  audit(actor, action, requestId, details = {}) {
    const prevHash = this.lastAuditHash || '';
    const row = {
      id: randomId('audit'),
      actor,
      action,
      requestId: requestId || null,
      timestamp: nowIso(),
      details,
      prevHash
    };
    row.hash = hashAuditRow(prevHash, row);
    this.lastAuditHash = row.hash;
    this.auditLogs.push(row);
    if (this.persistence) this.persistence.insertAudit(row);
    return row;
  }

  // Recompute the chain from stored fields; report the first row whose hash or link is wrong.
  verifyAuditChain() {
    let prevHash = '';
    for (let i = 0; i < this.auditLogs.length; i += 1) {
      const row = this.auditLogs[i];
      if ((row.prevHash || '') !== prevHash) {
        return { ok: false, brokenAt: row.id, index: i, reason: 'prevHash link mismatch' };
      }
      if (hashAuditRow(prevHash, row) !== row.hash) {
        return { ok: false, brokenAt: row.id, index: i, reason: 'row hash mismatch' };
      }
      prevHash = row.hash;
    }
    return { ok: true, count: this.auditLogs.length };
  }

  // Public gateway view: never expose the shared secret or outbound apiKey to the dashboard.
  publicGateways() {
    return this.listGateways().map(({ secret, apiKey, ...rest }) => rest);
  }

  snapshot() {
    return {
      gateways: this.publicGateways(),
      requests: this.listRequests(),
      smsOutbox: this.smsOutbox.slice(-50),
      smsInbox: this.smsInbox.slice(-50),
      replyDrafts: this.replyDrafts.slice(-50),
      auditLogs: this.auditLogs.slice(-100)
    };
  }
}

// Deterministic, key-sorted serialization so the hash is stable across restarts and Node versions.
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

function hashAuditRow(prevHash, row) {
  const payload = canonicalize({
    id: row.id,
    actor: row.actor,
    action: row.action,
    requestId: row.requestId,
    timestamp: row.timestamp,
    details: row.details
  });
  return createHash('sha256').update(`${prevHash}${payload}`).digest('hex');
}

function extractSilentReference(messageBody) {
  return String(messageBody || '').match(/\b(?:REF|SR)[:\s-]*(SR[A-Z0-9]+)\b/i)?.[1]?.toUpperCase() || null;
}

module.exports = { AutomationStore, extractSilentReference };
