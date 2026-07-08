'use strict';

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
    authConfig: { adminApiKey: 'unused-legacy-key', requireGatewayAuth: false, denyUnknownRequesters: false, registrationWindowEndsAt: null },
    gatewayConfig: {},
    mailConfig: {},
    bootstrapSuperAdmin: false
  });
}

test('POST /api/auth/register rejects a phone/email pair not found in the Personnel Registry', async () => {
  const app = appWith();
  const res = await call(app, {
    method: 'POST',
    url: '/api/auth/register',
    body: { name: 'Nobody', email: 'nobody@example.com', phone: '01700000000', password: 'longenough1' }
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Personnel Registry/);
  assert.equal(app.userAuth.getUserByEmail('nobody@example.com'), null);
});

test('POST /api/auth/register rejects a registered phone paired with someone else\'s email (no mix-and-match)', async () => {
  const app = appWith();
  app.userAuth.replaceRegistry([
    { name: 'SI Ahmed', phone: '01711111111', email: 'ahmed@police.gov.bd' },
    { name: 'SI Karim', phone: '01722222222', email: 'karim@police.gov.bd' }
  ], 'admin-1');

  const res = await call(app, {
    method: 'POST',
    url: '/api/auth/register',
    body: { name: 'SI Ahmed', email: 'karim@police.gov.bd', phone: '01711111111', password: 'longenough1' }
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Personnel Registry/);
});

test('POST /api/auth/register succeeds when phone and email match the same registry record, and persists designation/unit', async () => {
  const app = appWith();
  app.userAuth.replaceRegistry([
    { name: 'SI Ahmed', designation: 'Sub-Inspector', unit: 'LIC Barishal', phone: '01711111111', email: 'ahmed@police.gov.bd' }
  ], 'admin-1');

  const res = await call(app, {
    method: 'POST',
    url: '/api/auth/register',
    body: {
      name: 'SI Ahmed', designation: 'Sub-Inspector', unit: 'LIC Barishal',
      email: 'ahmed@police.gov.bd', phone: '01711111111', password: 'longenough1'
    }
  });
  assert.equal(res.status, 200);
  const user = app.userAuth.getUserByEmail('ahmed@police.gov.bd');
  assert.ok(user);
  assert.equal(user.designation, 'Sub-Inspector');
  assert.equal(user.unit, 'LIC Barishal');
  assert.equal(user.telegram_id, null);
});

test('POST /api/telegram/registration-link requires admin auth', async () => {
  const app = appWith();
  const res = await call(app, { method: 'POST', url: '/api/telegram/registration-link', body: { telegramId: '999' } });
  assert.equal(res.status, 401);
});

test('POST /api/telegram/registration-link mints a token, and registering with it links the telegramId', async () => {
  const app = appWith();
  app.userAuth.replaceRegistry([
    { name: 'SI Ahmed', phone: '01711111111', email: 'ahmed@police.gov.bd' }
  ], 'admin-1');

  const link = await call(app, {
    method: 'POST',
    url: '/api/telegram/registration-link',
    headers: { 'x-api-key': 'unused-legacy-key' },
    body: { telegramId: '424242' }
  });
  assert.equal(link.status, 200);
  assert.match(link.json.url, /\/register\.html\?token=/);
  const token = new URL(link.json.url).searchParams.get('token');

  const reg = await call(app, {
    method: 'POST',
    url: '/api/auth/register',
    body: {
      name: 'SI Ahmed', email: 'ahmed@police.gov.bd', phone: '01711111111', password: 'longenough1',
      registrationToken: token
    }
  });
  assert.equal(reg.status, 200);
  const user = app.userAuth.getUserByEmail('ahmed@police.gov.bd');
  assert.equal(user.telegram_id, '424242');
});

test('POST /api/auth/register rejects an invalid/expired registrationToken even when phone+email match', async () => {
  const app = appWith();
  app.userAuth.replaceRegistry([
    { name: 'SI Ahmed', phone: '01711111111', email: 'ahmed@police.gov.bd' }
  ], 'admin-1');

  const reg = await call(app, {
    method: 'POST',
    url: '/api/auth/register',
    body: {
      name: 'SI Ahmed', email: 'ahmed@police.gov.bd', phone: '01711111111', password: 'longenough1',
      registrationToken: 'bogus-token'
    }
  });
  assert.equal(reg.status, 400);
  assert.match(reg.json.error, /Invalid or expired/);
  assert.equal(app.userAuth.getUserByEmail('ahmed@police.gov.bd'), null);
});
