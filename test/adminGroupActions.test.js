'use strict';

// Integration tests for the admin group-actions endpoints (security-hardening
// v1 step 7, design doc §9): POST /api/telegram/moderation-check (fresh
// per-attempt authorization) and POST /api/telegram/moderation-action
// (audit-only, reported by the bridge after it executes the real Telegram
// API call — this backend holds no bot token and cannot moderate directly).
// The post-any-message bypass itself is unit-tested at the service level in
// test/workflow.test.js; this file covers the bridge-facing HTTP surface.

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

function appWith() {
  return createApp({
    dbPath: '',
    authDbPath: ':memory:',
    authConfig: { adminApiKey: 'topsecret', requireGatewayAuth: false, denyUnknownRequesters: false },
    gatewayConfig: {},
    mailConfig: {},
    bootstrapSuperAdmin: false
  });
}

function createLinkedUser(app, { email, telegramId, role, status = 'active', phone = '01799990000' }) {
  const reg = app.userAuth.register({ email, password: 'longenough1', name: 'Test User', phone, role, telegramId });
  app.userAuth.verifyEmail(reg.verifyToken, {});
  if (status !== 'active') app.userAuth.setStatus(reg.id, status);
  return app.userAuth.getUserByEmail(email);
}

test('POST /api/telegram/moderation-check requires admin (bridge) auth', async () => {
  const app = appWith();
  const res = await call(app, { method: 'POST', url: '/api/telegram/moderation-check', body: { telegramId: '1' } });
  assert.equal(res.status, 401);
});

test('POST /api/telegram/moderation-check authorizes a linked admin/super_admin and rejects an officer', async () => {
  const app = appWith();
  createLinkedUser(app, { email: 'admin-mod@example.com', telegramId: '111', role: 'admin' });
  createLinkedUser(app, { email: 'super-mod@example.com', telegramId: '222', role: 'super_admin' });
  createLinkedUser(app, { email: 'officer-mod@example.com', telegramId: '333', role: 'officer' });

  const asAdmin = await call(app, {
    method: 'POST', url: '/api/telegram/moderation-check',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { telegramId: '111' }
  });
  assert.equal(asAdmin.json.authorized, true);
  assert.equal(asAdmin.json.actorName, 'Test User');

  const asSuperAdmin = await call(app, {
    method: 'POST', url: '/api/telegram/moderation-check',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { telegramId: '222' }
  });
  assert.equal(asSuperAdmin.json.authorized, true);

  const asOfficer = await call(app, {
    method: 'POST', url: '/api/telegram/moderation-check',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { telegramId: '333' }
  });
  assert.equal(asOfficer.json.authorized, false);

  const unknown = await call(app, {
    method: 'POST', url: '/api/telegram/moderation-check',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { telegramId: 'never-linked' }
  });
  assert.equal(unknown.json.authorized, false);
});

test('POST /api/telegram/moderation-check rejects a disabled admin account', async () => {
  const app = appWith();
  createLinkedUser(app, { email: 'disabled-admin@example.com', telegramId: '444', role: 'admin', status: 'disabled' });
  const res = await call(app, {
    method: 'POST', url: '/api/telegram/moderation-check',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { telegramId: '444' }
  });
  assert.equal(res.json.authorized, false);
});

test('POST /api/telegram/moderation-action requires admin auth and audits the reported outcome', async () => {
  const app = appWith();
  const denied = await call(app, { method: 'POST', url: '/api/telegram/moderation-action', body: { action: 'ban', actorTelegramId: '111' } });
  assert.equal(denied.status, 401);

  const res = await call(app, {
    method: 'POST', url: '/api/telegram/moderation-action',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: {
      action: 'ban', actorTelegramId: '111', actorName: 'Admin Officer',
      targetTelegramId: '999', targetName: 'Rogue User', chatId: '-100123', success: true
    }
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);

  const audit = app.store.auditLogs.at(-1);
  assert.equal(audit.action, 'TELEGRAM_MODERATION_ACTION');
  assert.equal(audit.actor, 'Admin Officer');
  assert.equal(audit.details.action, 'ban');
  assert.equal(audit.details.targetTelegramId, '999');
  assert.equal(audit.details.success, true);
});

test('POST /api/telegram/moderation-action requires action and actorTelegramId', async () => {
  const app = appWith();
  const res = await call(app, {
    method: 'POST', url: '/api/telegram/moderation-action',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { action: 'ban' }
  });
  assert.equal(res.status, 400);
});
