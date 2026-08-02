'use strict';

// Integration tests for the group-registration gate (security-hardening v1
// follow-on, closes the piece of step 5 left open: the Telegram group was
// fully open regardless of registration). Covers the wiring in
// POST /api/requests: an unregistered Telegram-channel sender is nudged
// (grace window open) or blocked (window closed); a registered sender, or
// any non-Telegram channel, is untouched. Pure logic (isWithinRegistrationWindow)
// is unit-tested in test/userAuth.test.js — this file covers the wiring.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApp } = require('../src/app');

function mockReq({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from([payload]);
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function mockRes() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    writeHead(code, headers) {
      this.statusCode = code;
      if (headers) Object.assign(this.headers, headers);
    },
    setHeader(name, value) {
      this.headers[name] = value;
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
  return { status: res.statusCode, json };
}

function appWith({ registrationWindowEndsAt } = {}) {
  return createApp({
    dbPath: '',
    authDbPath: ':memory:',
    authConfig: { adminApiKey: 'topsecret', requireGatewayAuth: false, denyUnknownRequesters: false, registrationWindowEndsAt },
    gatewayConfig: { GP: { secret: 'gp-secret', trustedSenders: ['12345'] } },
    mailConfig: {},
    bootstrapSuperAdmin: false
  });
}

function createLinkedOfficer(app, { email, telegramId, phone = '01799990000' }) {
  const reg = app.userAuth.register({ email, password: 'longenough1', name: 'Officer QA', phone, role: 'officer', telegramId });
  app.userAuth.verifyEmail(reg.verifyToken, {});
  return app.userAuth.getUserByEmail(email);
}

function submitAs(app, telegramId, text, { channel = 'telegram' } = {}) {
  return call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { requesterId: telegramId, requesterName: 'Officer QA', text, channel }
  });
}

test('an unregistered Telegram sender is nudged (not blocked) while the grace window is open', async () => {
  // No registrationWindowEndsAt configured — isWithinRegistrationWindow()
  // treats that as always-open, matching real deploys before the window is set.
  const app = appWith();
  const res = await submitAs(app, '999888', 'LRL 01712345678');
  assert.equal(res.status, 201);
  assert.equal(res.json.ok, true);
  assert.match(res.json.registrationNote, /not registered yet/i);
  assert.match(res.json.registrationNote, /register\.html\?token=/);
});

test('an unregistered Telegram sender is blocked once the grace window has closed', async () => {
  const app = appWith({ registrationWindowEndsAt: new Date(Date.now() - 60_000).toISOString() });
  const res = await submitAs(app, '999888', 'LRL 01712345678');
  assert.equal(res.status, 400);
  assert.equal(res.json.ok, false);
  assert.equal(res.json.errorCode, 'REGISTRATION_REQUIRED');
  assert.match(res.json.replyText, /register\.html\?token=/);
});

test('a registered, linked officer is never nudged or blocked, window open or closed', async () => {
  const openApp = appWith();
  createLinkedOfficer(openApp, { email: 'linked-open@example.com', telegramId: '112233' });
  const openRes = await submitAs(openApp, '112233', 'LRL 01712345678');
  assert.equal(openRes.status, 201);
  assert.equal(openRes.json.registrationNote, undefined);

  const closedApp = appWith({ registrationWindowEndsAt: new Date(Date.now() - 60_000).toISOString() });
  createLinkedOfficer(closedApp, { email: 'linked-closed@example.com', telegramId: '445566' });
  const closedRes = await submitAs(closedApp, '445566', 'LRL 01712345678');
  assert.equal(closedRes.status, 201);
  assert.equal(closedRes.json.registrationNote, undefined);
});

test('the gate never applies to a non-Telegram channel, even for an unregistered/unlinked requesterId, window open or closed', async () => {
  const closedApp = appWith({ registrationWindowEndsAt: new Date(Date.now() - 60_000).toISOString() });
  const res = await submitAs(closedApp, '999888', 'LRL 01712345678', { channel: 'manual' });
  assert.equal(res.status, 201);
  assert.notEqual(res.json.errorCode, 'REGISTRATION_REQUIRED');
  assert.equal(res.json.registrationNote, undefined);
});

test('a blocked (unregistered, window closed) request never reaches service.submitRequest — no request is created', async () => {
  const app = appWith({ registrationWindowEndsAt: new Date(Date.now() - 60_000).toISOString() });
  await submitAs(app, '999888', 'LRL 01712345678');
  assert.equal(app.store.listRequests().length, 0);
});

test('POST /api/telegram/registration-link and the gate\'s soft-nag produce links from the same helper (both use createRegistrationToken)', async () => {
  const app = appWith();
  const linkRes = await call(app, {
    method: 'POST',
    url: '/api/telegram/registration-link',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { telegramId: '777999' }
  });
  assert.equal(linkRes.status, 200);
  assert.match(linkRes.json.url, /register\.html\?token=/);

  const nudgeRes = await submitAs(app, '888111', 'LRL 01712345678');
  assert.match(nudgeRes.json.registrationNote, /register\.html\?token=/);
});
