'use strict';

// Integration tests for server-side page gating (security-hardening-v1 step 2):
// GET / and GET /admin must be enforced server-side via the session cookie set
// at login, not just left to client-side JS to hide/redirect after the fact.

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

// Unlike the mocks in other test files, this one captures headers set via both
// writeHead(code, headers) and setHeader(name, value) — needed to assert on
// Set-Cookie (login/logout) and Location (redirects), matching how a real
// http.ServerResponse merges the two (setHeader values are folded into the
// eventual writeHead call).
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
  return { status: res.statusCode, headers: res.headers, json, raw: res.body };
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

// Directly creates a verified account + a session row, bypassing the real
// login/MFA flow entirely. This is deliberate: since the access-model
// correction (2026-07-15) blocks officer-role accounts from completing
// login at all (userAuth.startLogin), these page-gating tests need a way
// to construct an officer session anyway — the point is to prove the
// server-side page gate (guardPage/requireAdmin) still rejects that role
// as defense in depth, independent of whether the login flow can produce
// one for real. Session creation is the same shape completeLogin() uses.
async function registerAndLogin(app, { email, password, role }) {
  const user = app.userAuth.createVerifiedUser({ email, password, name: 'Test User', role: role || 'officer' });
  const token = require('node:crypto').randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  app.userAuth.db
    .prepare('INSERT INTO auth_sessions (token, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
    .run(token, user.id, now, expiresAt, '127.0.0.1', 'test');
  return { token, setCookie: `sessionToken=${token}; Path=/; HttpOnly; SameSite=Lax` };
}

function cookieHeaderFrom(setCookieValue) {
  // Simulate the browser: take just "sessionToken=<value>" back off the
  // Set-Cookie string and send it as the request's Cookie header.
  return setCookieValue.split(';')[0];
}

test('GET / with no session redirects to /login.html, does not serve the page', async () => {
  const app = appWith();
  const res = await call(app, { method: 'GET', url: '/' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/login.html');
  assert.equal(res.raw, '', 'the HTML must never be sent to an unauthenticated request');
});

test('GET /admin with no session redirects to /login.html', async () => {
  const app = appWith();
  const res = await call(app, { method: 'GET', url: '/admin' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/login.html');
});

test('mfa/verify sets a session cookie, and that cookie unlocks GET /', async () => {
  const app = appWith();
  const { setCookie } = await registerAndLogin(app, { email: 'officer@example.com', password: 'longenough1', role: 'officer' });
  assert.ok(setCookie, 'login must set a session cookie for page-level auth');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);

  const res = await call(app, { method: 'GET', url: '/', headers: { cookie: cookieHeaderFrom(setCookie) } });
  assert.equal(res.status, 200);
  assert.match(res.raw, /<!doctype html>|<html/i);
});

test('an officer session is redirected away from /admin (insufficient role), not to /login.html', async () => {
  const app = appWith();
  const { setCookie } = await registerAndLogin(app, { email: 'officer2@example.com', password: 'longenough1', role: 'officer' });

  const res = await call(app, { method: 'GET', url: '/admin', headers: { cookie: cookieHeaderFrom(setCookie) } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/', 'an authenticated-but-insufficient-role request should land somewhere real, not a login loop');
});

test('an admin session unlocks /admin', async () => {
  const app = appWith();
  const { setCookie } = await registerAndLogin(app, { email: 'admin1@example.com', password: 'longenough1', role: 'admin' });

  const res = await call(app, { method: 'GET', url: '/admin', headers: { cookie: cookieHeaderFrom(setCookie) } });
  assert.equal(res.status, 200);
});

test('a super_admin session unlocks /admin too', async () => {
  const app = appWith();
  const { setCookie } = await registerAndLogin(app, { email: 'super1@example.com', password: 'longenough1', role: 'super_admin' });

  const res = await call(app, { method: 'GET', url: '/admin', headers: { cookie: cookieHeaderFrom(setCookie) } });
  assert.equal(res.status, 200);
});

// Step-up re-authentication follow-on: session.created_at (set at MFA-completion
// time) doubles as "how long since this super_admin last proved who they are."
test('a super_admin session older than the 15-minute re-auth window is bounced to step-up login, not served /admin', async () => {
  const app = appWith();
  const { token, setCookie } = await registerAndLogin(app, { email: 'super2@example.com', password: 'longenough1', role: 'super_admin' });
  const cookieHeader = cookieHeaderFrom(setCookie);

  const fresh = await call(app, { method: 'GET', url: '/admin', headers: { cookie: cookieHeader } });
  assert.equal(fresh.status, 200);

  const staleCreatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  app.userAuth.db.prepare('UPDATE auth_sessions SET created_at = ? WHERE token = ?').run(staleCreatedAt, token);

  const stale = await call(app, { method: 'GET', url: '/admin', headers: { cookie: cookieHeader } });
  assert.equal(stale.status, 302);
  assert.equal(stale.headers.location, '/login.html?stepup=1&return=%2Fadmin');
  assert.equal(stale.raw, '', 'the admin console HTML must never be sent while the session is stale');
});

test('the step-up re-auth window does not apply to a plain admin session, only super_admin', async () => {
  const app = appWith();
  const { token, setCookie } = await registerAndLogin(app, { email: 'admin2@example.com', password: 'longenough1', role: 'admin' });
  const cookieHeader = cookieHeaderFrom(setCookie);

  const staleCreatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  app.userAuth.db.prepare('UPDATE auth_sessions SET created_at = ? WHERE token = ?').run(staleCreatedAt, token);

  const stillOk = await call(app, { method: 'GET', url: '/admin', headers: { cookie: cookieHeader } });
  assert.equal(stillOk.status, 200);
});

test('logout clears the session cookie and the page gate rejects the old cookie afterward', async () => {
  const app = appWith();
  const { token, setCookie } = await registerAndLogin(app, { email: 'officer3@example.com', password: 'longenough1', role: 'officer' });
  const cookieHeader = cookieHeaderFrom(setCookie);

  // Sanity: the cookie works before logout.
  assert.equal((await call(app, { method: 'GET', url: '/', headers: { cookie: cookieHeader } })).status, 200);

  const logout = await call(app, {
    method: 'POST',
    url: '/api/auth/logout',
    headers: { authorization: `Bearer ${token}`, cookie: cookieHeader }
  });
  assert.match(logout.headers['Set-Cookie'], /Max-Age=0/, 'logout must clear the cookie');

  // The underlying session is deleted server-side, so the old cookie value no
  // longer validates even though the browser hasn't been told to drop it yet.
  const afterLogout = await call(app, { method: 'GET', url: '/', headers: { cookie: cookieHeader } });
  assert.equal(afterLogout.status, 302);
  assert.equal(afterLogout.headers.location, '/login.html');
});

test('the legacy admin API key does NOT unlock page routes (no transport for it on a plain navigation)', async () => {
  const app = createApp({
    dbPath: '',
    authDbPath: ':memory:',
    authConfig: { adminApiKey: 'topsecret', requireGatewayAuth: false, denyUnknownRequesters: false },
    gatewayConfig: {},
    mailConfig: {},
    bootstrapSuperAdmin: false
  });
  // A browser page navigation cannot attach a custom x-api-key header, so even
  // sending it here (more than a real navigation could ever do) must not work —
  // page access requires an actual cookie-backed login.
  const res = await call(app, { method: 'GET', url: '/admin', headers: { 'x-api-key': 'topsecret' } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/login.html');
});

test('unrelated static assets and the login page itself are never gated', async () => {
  const app = appWith();
  const login = await call(app, { method: 'GET', url: '/login.html' });
  assert.equal(login.status, 200, 'the login page must stay reachable to unauthenticated visitors, or nobody could ever log in');

  const sharedJs = await call(app, { method: 'GET', url: '/shared.js' });
  assert.equal(sharedJs.status, 200);
});
