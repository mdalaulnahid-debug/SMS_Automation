'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApp } = require('../src/app');
const { UserAuthStore } = require('../src/userAuth');

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

// --- Unit tests against the store directly ---

test('register -> verify -> login -> mfa -> session', () => {
  const store = new UserAuthStore(':memory:');

  const reg = store.register({ email: 'Officer@Example.com', password: 'longenough1', name: 'Officer One' });
  assert.ok(reg.verifyToken);

  assert.throws(() => store.startLogin({ email: 'officer@example.com', password: 'longenough1' }), /verify your email/);

  store.verifyEmail(reg.verifyToken);
  assert.throws(() => store.verifyEmail(reg.verifyToken), /Invalid or already-used/);

  const login = store.startLogin({ email: 'officer@example.com', password: 'longenough1' });
  assert.ok(login.pendingToken);
  assert.match(login.mfaCode, /^\d{6}$/);

  assert.throws(() => store.completeLogin({ pendingToken: login.pendingToken, code: '000000' }), /Incorrect verification code/);

  const session = store.completeLogin({ pendingToken: login.pendingToken, code: login.mfaCode });
  assert.ok(session.token);
  assert.equal(session.user.email, 'officer@example.com');

  const validated = store.validateSession(session.token);
  assert.equal(validated.user.id, session.user.id);

  store.logout(session.token);
  assert.equal(store.validateSession(session.token), null);
});

test('wrong password and duplicate registration are rejected', () => {
  const store = new UserAuthStore(':memory:');
  store.register({ email: 'a@example.com', password: 'longenough1', name: 'A' });
  assert.throws(() => store.register({ email: 'a@example.com', password: 'longenough1', name: 'A' }), /already exists/);

  const reg2 = store.register({ email: 'b@example.com', password: 'correcthorse1', name: 'B' });
  store.verifyEmail(reg2.verifyToken);
  assert.throws(() => store.startLogin({ email: 'b@example.com', password: 'wrongpass1' }), /Invalid email or password/);
});

test('disabled account cannot log in', () => {
  const store = new UserAuthStore(':memory:');
  const reg = store.register({ email: 'c@example.com', password: 'longenough1', name: 'C' });
  const user = store.verifyEmail(reg.verifyToken);
  store.setStatus(user.id, 'disabled');
  assert.throws(() => store.startLogin({ email: 'c@example.com', password: 'longenough1' }), /disabled/);
});

test('super-admin bootstrap creates a verified account directly', () => {
  const store = new UserAuthStore(':memory:');
  const sa = store.createVerifiedUser({ email: 'super@example.com', password: 'topsecretpass', name: 'Super Admin', role: 'super_admin' });
  assert.equal(sa.role, 'super_admin');
  assert.equal(sa.email_verified, 1);
  const login = store.startLogin({ email: 'super@example.com', password: 'topsecretpass' });
  const session = store.completeLogin({ pendingToken: login.pendingToken, code: login.mfaCode });
  assert.equal(session.user.role, 'super_admin');
});

// --- HTTP-level tests against app.js routes ---

function appWith(envOverrides = {}) {
  const prevEnv = { ...process.env };
  Object.assign(process.env, envOverrides);
  const app = createApp({
    dbPath: '',
    authDbPath: ':memory:',
    authConfig: { adminApiKey: '', requireGatewayAuth: false, denyUnknownRequesters: false },
    gatewayConfig: {},
    // Never let tests read the real config/mail.json (Gmail credentials) or send live email.
    mailConfig: {},
    bootstrapSuperAdmin: false
  });
  process.env = prevEnv;
  return app;
}

test('full HTTP register/verify/login/mfa/me/logout flow', async () => {
  const app = appWith();

  const register = await call(app, {
    method: 'POST',
    url: '/api/auth/register',
    body: { email: 'officer@example.com', password: 'longenough1', name: 'Officer One' }
  });
  assert.equal(register.status, 200);

  const user = app.userAuth.getUserByEmail('officer@example.com');
  const verify = await call(app, { method: 'GET', url: `/verify-email?token=${user.verify_token}` });
  assert.equal(verify.status, 200);

  const login = await call(app, {
    method: 'POST',
    url: '/api/auth/login',
    body: { email: 'officer@example.com', password: 'longenough1' }
  });
  assert.equal(login.status, 200);
  assert.ok(login.json.pendingToken);

  // The HTTP layer never echoes the MFA code back (it's emailed); read it from the store the way
  // the mailer would have, since mailer.sendMail logs to console in tests rather than sending.
  const pendingUser = app.userAuth.db.prepare('SELECT * FROM auth_users WHERE pending_session_token = ?').get(login.json.pendingToken);
  assert.ok(pendingUser);

  const freshLogin = app.userAuth.startLogin({ email: 'officer@example.com', password: 'longenough1' });
  const mfa = await call(app, {
    method: 'POST',
    url: '/api/auth/mfa/verify',
    body: { pendingToken: freshLogin.pendingToken, code: freshLogin.mfaCode }
  });
  assert.equal(mfa.status, 200);
  assert.ok(mfa.json.token);

  const me = await call(app, {
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: `Bearer ${mfa.json.token}` }
  });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, 'officer@example.com');

  const meNoAuth = await call(app, { method: 'GET', url: '/api/auth/me' });
  assert.equal(meNoAuth.status, 401);

  const logout = await call(app, {
    method: 'POST',
    url: '/api/auth/logout',
    headers: { authorization: `Bearer ${mfa.json.token}` }
  });
  assert.equal(logout.status, 200);

  const meAfterLogout = await call(app, {
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: `Bearer ${mfa.json.token}` }
  });
  assert.equal(meAfterLogout.status, 401);
});

test('super-admin bootstrap via env vars creates the account on createApp', () => {
  process.env.SUPERADMIN_EMAIL = 'mdalaulnahid@example.com';
  process.env.SUPERADMIN_PASSWORD = 'bootstrap-pass-1';
  // Point at a nonexistent file so loadMailConfig() relies purely on the env vars above,
  // never reading the real (gitignored) config/mail.json Gmail credentials during tests.
  process.env.SMS_MAIL_CONFIG = require('node:path').join(__dirname, 'fixtures', 'no-such-mail-config.json');
  try {
    const app = createApp({
      dbPath: '',
      authDbPath: ':memory:',
      authConfig: { adminApiKey: '', requireGatewayAuth: false, denyUnknownRequesters: false },
      gatewayConfig: {}
    });
    const sa = app.userAuth.getUserByEmail('mdalaulnahid@example.com');
    assert.ok(sa);
    assert.equal(sa.role, 'super_admin');
  } finally {
    delete process.env.SUPERADMIN_EMAIL;
    delete process.env.SUPERADMIN_PASSWORD;
    delete process.env.SMS_MAIL_CONFIG;
  }
});
