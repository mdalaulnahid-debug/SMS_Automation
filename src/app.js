'use strict';

const { readFile, stat, createReadStream } = require('node:fs');
const { readFile: readFileAsync } = require('node:fs/promises');
const { join } = require('node:path');
const https = require('node:https');
const { AutomationStore } = require('./store');
const { OperatorQueue } = require('./queue');
const { SmsGatewayClient } = require('./smsGateway');
const { AutomationService } = require('./service');
const { loadGatewayConfig, loadAuthConfig, loadTelegramConfig } = require('./config');
const { isAdmin, isValidGateway } = require('./auth');
const { getBackendUrls, getLanAddresses, getPreferredLanIp } = require('./network');

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

// Fire-and-forget Telegram alert to the admin/watchdog chat when an unauthorized send is detected.
function sendTelegramWatchdogAlert(telegramConfig, { gatewayId, recipient, snippet }) {
  const botToken = telegramConfig.botToken;
  const chatId = telegramConfig.watchdogAlertChatId || telegramConfig.groupChatId;
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
  const service = new AutomationService({
    store,
    queue,
    smsGateway,
    denyUnknownRequesters: authConfig.denyUnknownRequesters,
    autoApproveChannels
  });

  // Restore the per-operator waiting lists from any persisted QUEUED requests.
  queue.rebuild();

  // Automatically time out waiting dispatches every 60 seconds. Without this, requests
  // would stay stuck in WAITING_OPERATOR_REPLY indefinitely if nobody hits /api/timeouts/run.
  setInterval(() => {
    service.timeoutWaitingRequests().catch((err) => {
      console.error('[timeout] auto-run error:', err.message);
    });
  }, 60_000);

  // Resume sending for requests that were queued (but not yet dispatched) before a restart.
  async function recover() {
    return smsGateway.dispatchAll();
  }

  const requireAdmin = (req, res) => {
    if (isAdmin(req, authConfig)) return true;
    json(res, 401, { error: 'Admin authentication required.' });
    return false;
  };

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
        return serveFile(res, 'index.html', 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/app.js') {
        return serveFile(res, 'app.js', 'text/javascript; charset=utf-8');
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
        if (!requireAdmin(req, res)) return undefined;
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
        const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min
        const now = Date.now();
        const gateways = store.listGateways().map((gw) => {
          const lastSeenMs = gw.lastSeenAt ? new Date(gw.lastSeenAt).getTime() : 0;
          const online = gw.status === 'CONFIGURED' && now - lastSeenMs < ONLINE_THRESHOLD_MS;
          return { ...gw, online };
        });
        return json(res, 200, { gateways });
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
      if (req.method === 'GET' && req.url === '/api/dashboard') {
        if (!requireAdmin(req, res)) return undefined;
        return json(res, 200, {
          ...store.snapshot(),
          queues: queue.snapshot()
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
        const result = await service.submitRequest(body);
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
        return json(res, 200, { jobs });
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
        if (!requireAdmin(req, res)) return undefined;
        return json(res, 200, { users: store.listUsers() });
      }
      if (req.method === 'POST' && req.url === '/api/users') {
        if (!requireAdmin(req, res)) return undefined;
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
        if (!requireAdmin(req, res)) return undefined;
        const telegramId = decodeURIComponent(req.url.split('/').at(-2) || '');
        const body = await readJson(req);
        const user = store.setUserStatus(telegramId, body.status);
        store.audit('admin', 'USER_STATUS_CHANGED', null, { telegramId, status: body.status });
        return json(res, 200, { user });
      }
      if (req.method === 'GET' && req.url === '/api/audit/verify') {
        if (!requireAdmin(req, res)) return undefined;
        return json(res, 200, store.verifyAuditChain());
      }
      if (req.method === 'GET' && req.url === '/api/audit/export') {
        if (!requireAdmin(req, res)) return undefined;
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
        if (!requireAdmin(req, res)) return undefined;
        const body = await readJson(req);
        if (!body.inboxId || !body.requestId) return json(res, 400, { error: 'inboxId and requestId required.' });
        const result = service.manualMatch(body.inboxId, body.requestId);
        return json(res, 200, result);
      }
      if (req.method === 'GET' && req.url === '/api/sms/unmatched') {
        if (!requireAdmin(req, res)) return undefined;
        const unmatched = store.smsInbox.filter((row) => !row.matchedRequestId && !row.analysis?.ignored);
        return json(res, 200, { unmatched });
      }
      if (req.method === 'POST' && req.url === '/api/timeouts/run') {
        if (!requireAdmin(req, res)) return undefined;
        return json(res, 200, { timedOut: await service.timeoutWaitingRequests() });
      }
      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }

  return { handle, store, queue, smsGateway, service, recover };
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

module.exports = { createApp };
