'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApp } = require('../src/app');
const { AutomationStore } = require('../src/store');

function mockReq({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from([payload]);
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

function mockRes() {
  return {
    statusCode: null,
    body: '',
    writeHead(code) {
      this.statusCode = code;
    },
    end(b) {
      this.body = b || '';
    }
  };
}

async function call(app, opts) {
  const res = mockRes();
  await app.handle(mockReq(opts), res);
  let json;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = null;
  }
  return { status: res.statusCode, json, raw: res.body };
}

function appWith(authConfig, gatewayConfig) {
  return createApp({
    dbPath: '',
    authConfig: { adminApiKey: '', requireGatewayAuth: false, denyUnknownRequesters: false, ...authConfig },
    gatewayConfig: gatewayConfig || { GP: { secret: 'gp-secret', trustedSenders: ['12345'] } }
  });
}

test('admin endpoints reject without the API key and accept with it', async () => {
  const app = appWith({ adminApiKey: 'topsecret' });

  const denied = await call(app, { method: 'GET', url: '/api/dashboard' });
  assert.equal(denied.status, 401);

  const ok = await call(app, { method: 'GET', url: '/api/dashboard', headers: { 'x-api-key': 'topsecret' } });
  assert.equal(ok.status, 200);

  const bearer = await call(app, {
    method: 'GET',
    url: '/api/dashboard',
    headers: { authorization: 'Bearer topsecret' }
  });
  assert.equal(bearer.status, 200);
});

test('inbound SMS webhook requires the gateway secret', async () => {
  const app = appWith({ adminApiKey: 'topsecret' });

  // Seed a pending request via admin so the inbound can match.
  await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { requesterId: '8801700000000', requesterName: 'Ofc', text: 'LRL 01712345678' }
  });

  const unsigned = await call(app, {
    method: 'POST',
    url: '/api/sms/inbound',
    headers: { 'content-type': 'application/json' },
    body: { gatewayId: 'GP_PHONE_01', from: '12345', body: 'LRL loc' }
  });
  assert.equal(unsigned.status, 401);

  const signed = await call(app, {
    method: 'POST',
    url: '/api/sms/inbound',
    headers: { 'content-type': 'application/json', 'x-gateway-secret': 'gp-secret' },
    body: { gatewayId: 'GP_PHONE_01', from: '12345', body: 'LRL loc' }
  });
  assert.equal(signed.status, 200);
  assert.equal(signed.json.ok, true);
});

test('submitting a request requires admin or a valid gateway secret', async () => {
  const app = appWith({ adminApiKey: 'topsecret' });
  const denied = await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'content-type': 'application/json' },
    body: { requesterId: '880170', requesterName: 'X', text: 'LRL 01712345678' }
  });
  assert.equal(denied.status, 401);
});

test('dashboard snapshot never leaks gateway secret or apiKey', async () => {
  const app = appWith({ adminApiKey: 'topsecret' }, { GP: { secret: 's', apiKey: 'k', trustedSenders: ['12345'] } });
  const res = await call(app, { method: 'GET', url: '/api/dashboard', headers: { 'x-api-key': 'topsecret' } });
  const gp = res.json.gateways.find((g) => g.id === 'GP_PHONE_01');
  assert.ok(gp);
  assert.equal(gp.secret, undefined);
  assert.equal(gp.apiKey, undefined);
});

test('deny-by-default rejects unknown requesters and allows provisioned ones', async () => {
  // adminApiKey empty â†’ admin auth disabled, so we can exercise the deny-unknown flag directly.
  const app = appWith({ denyUnknownRequesters: true });

  const unknown = await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'content-type': 'application/json' },
    body: { requesterId: '999', requesterName: 'Stranger', text: 'LRL 01712345678' }
  });
  assert.equal(unknown.status, 400);
  assert.match(unknown.json.replyText, /not an authorized requester/i);

  // Admin provisions the user, then the same request succeeds.
  await call(app, {
    method: 'POST',
    url: '/api/users',
    headers: { 'content-type': 'application/json' },
    body: { telegramId: '999', displayName: 'Now Allowed' }
  });
  const allowed = await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'content-type': 'application/json' },
    body: { requesterId: '999', requesterName: 'Now Allowed', text: 'LRL 01712345678' }
  });
  assert.equal(allowed.status, 201);
  assert.equal(allowed.json.ok, true);
});

test('disabled users are rejected even when deny-unknown is off', async () => {
  const app = appWith({});
  await call(app, {
    method: 'POST',
    url: '/api/users',
    headers: { 'content-type': 'application/json' },
    body: { telegramId: '555', displayName: 'Bad Actor', status: 'DISABLED' }
  });
  const blocked = await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'content-type': 'application/json' },
    body: { requesterId: '555', requesterName: 'Bad Actor', text: 'LRL 01712345678' }
  });
  assert.equal(blocked.status, 400);
  assert.match(blocked.json.replyText, /disabled/i);
});

test('strict gateway mode rejects gateways with no configured secret', async () => {
  // Strict mode in production always pairs with an admin key (else dev-mode admin bypasses auth).
  const app = appWith({ adminApiKey: 'topsecret', requireGatewayAuth: true }, { GP: { trustedSenders: ['12345'] } });
  const res = await call(app, {
    method: 'POST',
    url: '/api/sms/inbound',
    headers: { 'content-type': 'application/json' },
    body: { gatewayId: 'GP_PHONE_01', from: '12345', body: 'LRL loc' }
  });
  assert.equal(res.status, 401);
});

test('gateway heartbeat refreshes last-seen and online state', async () => {
  const app = appWith({ adminApiKey: 'topsecret' });
  await call(app, {
    method: 'POST',
    url: '/api/gateways/register',
    headers: { 'content-type': 'application/json', 'x-gateway-secret': 'gp-secret' },
    body: { gatewayId: 'GP_PHONE_01', host: '192.168.1.50', port: 8080 }
  });
  app.store.getGateway('GP_PHONE_01').lastSeenAt = '2000-01-01T00:00:00.000Z';

  const heartbeat = await call(app, {
    method: 'POST',
    url: '/api/gateway/heartbeat',
    headers: { 'content-type': 'application/json', 'x-gateway-secret': 'gp-secret' },
    body: { gatewayId: 'GP_PHONE_01' }
  });
  assert.equal(heartbeat.status, 200);
  assert.equal(heartbeat.json.ok, true);

  const gateways = await call(app, {
    method: 'GET',
    url: '/api/gateways',
    headers: { 'x-api-key': 'topsecret' }
  });
  const gp = gateways.json.gateways.find((gateway) => gateway.id === 'GP_PHONE_01');
  assert.equal(gp.online, true);
});

test('audit chain verifies clean and detects tampering', () => {
  const store = new AutomationStore();
  store.audit('a', 'EVENT_ONE', null, { x: 1 });
  store.audit('b', 'EVENT_TWO', 'REQ-1', { y: 2 });
  store.audit('c', 'EVENT_THREE', null, { z: 3 });

  assert.deepEqual(store.verifyAuditChain().ok, true);

  // Tamper a past entry's details â€” the chain must flag it.
  store.auditLogs[1].details = { y: 999 };
  const result = store.verifyAuditChain();
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, store.auditLogs[1].id);
});

test('audit chain detects a deleted row', () => {
  const store = new AutomationStore();
  store.audit('a', 'ONE', null, {});
  store.audit('b', 'TWO', null, {});
  store.audit('c', 'THREE', null, {});
  store.auditLogs.splice(1, 1); // remove the middle row
  assert.equal(store.verifyAuditChain().ok, false);
});

test('audit export returns CSV with the hash columns', async () => {
  const app = appWith({ adminApiKey: 'topsecret' });
  await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { requesterId: '880170', requesterName: 'Ofc', text: 'LRL 01712345678' }
  });
  const res = await call(app, { method: 'GET', url: '/api/audit/export', headers: { 'x-api-key': 'topsecret' } });
  assert.equal(res.status, 200);
  assert.match(res.raw.split('\r\n')[0], /id,timestamp,actor,action,requestId,details,prevHash,hash/);
  assert.ok(res.raw.split('\r\n').length > 1);
});
