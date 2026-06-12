'use strict';

const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { AutomationStore } = require('./store');
const { OperatorQueue } = require('./queue');
const { SmsGatewayClient } = require('./smsGateway');
const { AutomationService } = require('./service');
const { loadGatewayConfig, loadAuthConfig, loadTelegramConfig } = require('./config');
const { isAdmin, isValidGateway } = require('./auth');
const { getBackendUrls, getLanAddresses, getPreferredLanIp } = require('./network');

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
          service: 'sms-whatsapp-automation',
          version: '0.1.0',
          port,
          preferredLanIp,
          lanAddresses: lanAddresses.map((entry) => entry.address),
          backendUrls: getBackendUrls(port)
        });
      }
      if (req.method === 'POST' && req.url === '/api/gateways/register') {
        const body = await readJson(req);
        if (!isAdmin(req, authConfig) && !isValidGateway(req, body.gatewayId, store, authConfig)) {
          return json(res, 401, { error: 'Invalid or missing gateway secret.' });
        }
        const gateway = store.registerGateway(body.gatewayId, {
          host: body.host || body.localIp,
          port: body.port
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
        const result = await service.submitWhatsAppRequest(body);
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
      if (req.method === 'GET' && req.url === '/api/users') {
        if (!requireAdmin(req, res)) return undefined;
        return json(res, 200, { users: store.listUsers() });
      }
      if (req.method === 'POST' && req.url === '/api/users') {
        if (!requireAdmin(req, res)) return undefined;
        const body = await readJson(req);
        if (!body.whatsappId) return json(res, 400, { error: 'whatsappId is required.' });
        const user = store.upsertUser({
          whatsappId: body.whatsappId,
          displayName: body.displayName,
          role: body.role,
          allowedOperators: body.allowedOperators,
          status: body.status
        });
        store.audit('admin', 'USER_UPSERTED', null, { whatsappId: user.whatsappId });
        return json(res, 200, { user });
      }
      if (req.method === 'POST' && req.url.startsWith('/api/users/') && req.url.endsWith('/status')) {
        if (!requireAdmin(req, res)) return undefined;
        const whatsappId = decodeURIComponent(req.url.split('/').at(-2) || '');
        const body = await readJson(req);
        const user = store.setUserStatus(whatsappId, body.status);
        store.audit('admin', 'USER_STATUS_CHANGED', null, { whatsappId, status: body.status });
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
      if (req.method === 'GET' && req.url.startsWith('/api/whatsapp-replies')) {
        if (!requireAdmin(req, res)) return undefined;
        const url = new URL(req.url, 'http://localhost');
        const status = url.searchParams.get('status') || undefined;
        return json(res, 200, { whatsappReplies: store.listWhatsAppReplies({ status }) });
      }
      if (req.method === 'POST' && req.url.startsWith('/api/whatsapp-replies/')) {
        if (!requireAdmin(req, res)) return undefined;
        const id = decodeURIComponent(req.url.split('/').at(-2) || '');
        const action = req.url.split('/').at(-1);
        if (action === 'approve') {
          return json(res, 200, { request: await service.approveWhatsAppReply(id) });
        }
        if (action === 'posted') {
          const body = await readJson(req);
          return json(res, 200, {
            request: await service.markReplyPosted(id, { postedMessageId: body.postedMessageId })
          });
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

async function serveFile(res, fileName, contentType) {
  const content = await readFile(join(__dirname, '..', 'public', fileName), 'utf8');
  res.writeHead(200, { 'content-type': contentType });
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
