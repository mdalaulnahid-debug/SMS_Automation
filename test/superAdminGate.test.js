'use strict';

// The hidden super-admin login wall (access-model correction, 2026-07-15):
// a random /console/<slug> URL, never linked anywhere, that's the ONLY way
// a super_admin account can log in. The ordinary /login page rejects
// super_admin credentials outright, even when correct.

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
  return { status: res.statusCode, json, raw: res.body };
}

function appWith() {
  return createApp({
    dbPath: '',
    authDbPath: ':memory:',
    authConfig: { adminApiKey: '', requireGatewayAuth: false, denyUnknownRequesters: false },
    gatewayConfig: {},
    mailConfig: {},
    bootstrapSuperAdmin: false
  });
}

async function createSuperAdminSession(app, email = 'owner@example.com') {
  app.userAuth.createVerifiedUser({ email, password: 'longenough1', name: 'Owner', role: 'super_admin' });
  const login = app.userAuth.startSuperAdminLogin({ email, password: 'longenough1' });
  const session = app.userAuth.completeLogin({ pendingToken: login.pendingToken, code: login.mfaCode });
  return session.token;
}

test('a slug is generated automatically and is stable across calls', () => {
  const app = appWith();
  const first = app.userAuth.getSuperAdminGateSlug();
  const second = app.userAuth.getSuperAdminGateSlug();
  assert.ok(first);
  assert.equal(first, second);
});

test('GET /console/<wrong-slug> 404s indistinguishably from any unknown path', async () => {
  const app = appWith();
  const res = await call(app, { method: 'GET', url: '/console/not-the-real-slug' });
  assert.equal(res.status, 404);
});

test('GET /console/<real-slug> serves the hidden login page', async () => {
  const app = appWith();
  const slug = app.userAuth.getSuperAdminGateSlug();
  const res = await call(app, { method: 'GET', url: `/console/${slug}` });
  assert.equal(res.status, 200);
  assert.match(res.raw, /Sign in/);
});

test('POST /api/auth/login rejects a super_admin account outright, even with the correct password', async () => {
  const app = appWith();
  app.userAuth.createVerifiedUser({ email: 'owner@example.com', password: 'longenough1', name: 'Owner', role: 'super_admin' });
  const res = await call(app, {
    method: 'POST',
    url: '/api/auth/login',
    body: { email: 'owner@example.com', password: 'longenough1' }
  });
  assert.equal(res.status, 401);
  assert.equal(res.json.error, 'Invalid email or password.', 'must not hint that a separate login path exists');
});

test('POST /api/auth/super-login rejects admin and officer accounts, even with the correct password', async () => {
  const app = appWith();
  app.userAuth.createVerifiedUser({ email: 'plain-admin@example.com', password: 'longenough1', name: 'Plain Admin', role: 'admin' });

  const res = await call(app, {
    method: 'POST',
    url: '/api/auth/super-login',
    body: { email: 'plain-admin@example.com', password: 'longenough1' }
  });
  assert.equal(res.status, 401);
});

test('POST /api/auth/super-login + mfa/verify issues a real session for a super_admin', async () => {
  const app = appWith();
  const token = await createSuperAdminSession(app);
  assert.ok(token);

  const me = await call(app, { method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.role, 'super_admin');
});

test('GET /api/admin/super-admin-gate requires a super_admin session and returns the current URL', async () => {
  const app = appWith();
  const token = await createSuperAdminSession(app);
  const slug = app.userAuth.getSuperAdminGateSlug();

  const denied = await call(app, { method: 'GET', url: '/api/admin/super-admin-gate' });
  assert.equal(denied.status, 401);

  const res = await call(app, { method: 'GET', url: '/api/admin/super-admin-gate', headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  assert.match(res.json.url, new RegExp(`/console/${slug}$`));
});

test('POST /api/admin/super-admin-gate/regenerate rotates the URL — the old slug 404s immediately after', async () => {
  const app = appWith();
  const token = await createSuperAdminSession(app);
  const oldSlug = app.userAuth.getSuperAdminGateSlug();

  const res = await call(app, {
    method: 'POST',
    url: '/api/admin/super-admin-gate/regenerate',
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(res.status, 200);
  const newSlug = app.userAuth.getSuperAdminGateSlug();
  assert.notEqual(newSlug, oldSlug);

  const oldUrlNow = await call(app, { method: 'GET', url: `/console/${oldSlug}` });
  assert.equal(oldUrlNow.status, 404);

  const newUrlNow = await call(app, { method: 'GET', url: `/console/${newSlug}` });
  assert.equal(newUrlNow.status, 200);
});
