'use strict';

// Officer Portal access (2026-08-04): the old userAuth-based officer login is
// blocked entirely (see userAuth.test.js), so officers authenticate via the
// Telegram Login Widget instead, and are authorized purely by membership in
// the existing authorizedUsers DM allowlist -- no account/registration.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash, createHmac } = require('node:crypto');
const { createApp } = require('../src/app');

const BOT_TOKEN = 'test-bot-token';

function signPayload(fields, botToken = BOT_TOKEN) {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secretKey = createHash('sha256').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return { ...fields, hash };
}

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

test('Officer Portal Telegram login', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'portal-auth-'));
  const telegramConfigPath = join(root, 'telegram.json');
  writeFileSync(telegramConfigPath, JSON.stringify({
    botToken: BOT_TOKEN,
    authorizedUsers: {
      '111': { name: 'Officer Rahim' }
    }
  }));
  const previousEnv = process.env.SMS_TELEGRAM_CONFIG;
  process.env.SMS_TELEGRAM_CONFIG = telegramConfigPath;

  const app = createApp({
    dbPath: '',
    authDbPath: ':memory:',
    authConfig: { adminApiKey: 'unused-legacy-key', requireGatewayAuth: false, denyUnknownRequesters: false, registrationWindowEndsAt: null },
    gatewayConfig: {},
    mailConfig: {},
    bootstrapSuperAdmin: false
  });

  t.after(() => {
    if (previousEnv === undefined) delete process.env.SMS_TELEGRAM_CONFIG;
    else process.env.SMS_TELEGRAM_CONFIG = previousEnv;
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('an authorized Telegram user gets a portal session', async () => {
    const payload = signPayload({ id: 111, first_name: 'Rahim', username: 'rahim_officer', auth_date: Math.floor(Date.now() / 1000) });
    const res = await call(app, { method: 'POST', url: '/api/auth/telegram-login', body: payload });
    assert.equal(res.status, 200);
    assert.ok(res.json.token);
    assert.equal(res.json.user.name, 'Officer Rahim');
    assert.equal(res.json.user.username, 'rahim_officer');

    const me = await call(app, { method: 'GET', url: '/api/auth/portal-me', headers: { authorization: `Bearer ${res.json.token}` } });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.telegramUserId, '111');
  });

  await t.test('a Telegram user NOT in authorizedUsers is rejected', async () => {
    const payload = signPayload({ id: 999, first_name: 'Stranger', auth_date: Math.floor(Date.now() / 1000) });
    const res = await call(app, { method: 'POST', url: '/api/auth/telegram-login', body: payload });
    assert.equal(res.status, 403);
    assert.equal(res.json.error, 'not_authorized');
  });

  await t.test('a tampered payload (bad hash) is rejected outright', async () => {
    const payload = signPayload({ id: 111, first_name: 'Rahim', auth_date: Math.floor(Date.now() / 1000) });
    payload.first_name = 'Not Rahim';
    const res = await call(app, { method: 'POST', url: '/api/auth/telegram-login', body: payload });
    assert.equal(res.status, 401);
  });

  await t.test('portal-me with no/invalid token is rejected', async () => {
    const res = await call(app, { method: 'GET', url: '/api/auth/portal-me' });
    assert.equal(res.status, 401);
  });

  await t.test('portal-logout invalidates the session', async () => {
    const payload = signPayload({ id: 111, first_name: 'Rahim', auth_date: Math.floor(Date.now() / 1000) });
    const login = await call(app, { method: 'POST', url: '/api/auth/telegram-login', body: payload });
    const token = login.json.token;

    const logout = await call(app, { method: 'POST', url: '/api/auth/portal-logout', headers: { authorization: `Bearer ${token}` } });
    assert.equal(logout.status, 200);

    const me = await call(app, { method: 'GET', url: '/api/auth/portal-me', headers: { authorization: `Bearer ${token}` } });
    assert.equal(me.status, 401);
  });
});
