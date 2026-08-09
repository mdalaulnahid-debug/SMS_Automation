'use strict';

// Registration is invite-only (access-model correction, 2026-07-15): a
// super-admin issues an invite bound to a specific email/role via
// userAuth.createInvite(); POST /api/auth/register only ever accepts an
// invitationToken + password, never self-declared identity. Supersedes the
// old registry-match self-serve flow this file used to test.

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

async function createSuperAdminSession(app) {
  app.userAuth.createVerifiedUser({ email: 'owner@example.com', password: 'longenough1', name: 'Owner', role: 'super_admin' });
  // super_admin can only complete login via the hidden gate now.
  const login = app.userAuth.startSuperAdminLogin({ email: 'owner@example.com', password: 'longenough1' });
  const session = app.userAuth.completeLogin({ pendingToken: login.pendingToken, code: login.mfaCode });
  return session.token;
}

test('GET /api/auth/invite-status reports invalid for a missing/unknown token', async () => {
  const app = appWith();
  const res = await call(app, { method: 'GET', url: '/api/auth/invite-status?token=bogus' });
  assert.equal(res.status, 200);
  assert.equal(res.json.valid, false);
});

test('GET /api/auth/invite-status reports valid + the invitee identity for a real invite', async () => {
  const app = appWith();
  const invite = app.userAuth.createInvite({ email: 'ahmed@police.gov.bd', name: 'SI Ahmed', role: 'admin' });
  const res = await call(app, { method: 'GET', url: `/api/auth/invite-status?token=${invite.token}` });
  assert.equal(res.status, 200);
  assert.equal(res.json.valid, true);
  assert.equal(res.json.email, 'ahmed@police.gov.bd');
  assert.equal(res.json.name, 'SI Ahmed');
});

test('POST /api/auth/register rejects with no invitationToken — "You are not authorized for Registration"', async () => {
  const app = appWith();
  const res = await call(app, { method: 'POST', url: '/api/auth/register', body: { password: 'longenough1' } });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /not authorized for Registration/);
});

test('POST /api/auth/register rejects a bogus invitationToken', async () => {
  const app = appWith();
  const res = await call(app, {
    method: 'POST',
    url: '/api/auth/register',
    body: { invitationToken: 'bogus-token', password: 'longenough1' }
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /not authorized for Registration/);
  assert.equal(app.userAuth.getUserByEmail('ahmed@police.gov.bd'), null);
});

test('POST /api/auth/register succeeds with a valid invite, using the invite\'s identity (not client-submitted fields)', async () => {
  const app = appWith();
  const invite = app.userAuth.createInvite({
    email: 'ahmed@police.gov.bd', name: 'SI Ahmed', phone: '01711111111',
    designation: 'Sub-Inspector', unit: 'LIC Barishal', role: 'admin'
  });

  const res = await call(app, {
    method: 'POST',
    url: '/api/auth/register',
    // A tampered/different email in the body must be ignored — identity
    // comes from the invite record, never from this request.
    body: { invitationToken: invite.token, password: 'longenough1', email: 'attacker@example.com', role: 'super_admin' }
  });
  assert.equal(res.status, 200);

  const user = app.userAuth.getUserByEmail('ahmed@police.gov.bd');
  assert.ok(user, 'account created under the invited email, not the submitted one');
  assert.equal(user.role, 'admin', 'role comes from the invite, not the request body');
  assert.equal(user.designation, 'Sub-Inspector');
  assert.equal(user.unit, 'LIC Barishal');
  assert.equal(app.userAuth.getUserByEmail('attacker@example.com'), null);
});

test('an invite cannot be used twice', async () => {
  const app = appWith();
  const invite = app.userAuth.createInvite({ email: 'ahmed@police.gov.bd', name: 'SI Ahmed', role: 'admin' });

  const first = await call(app, {
    method: 'POST',
    url: '/api/auth/register',
    body: { invitationToken: invite.token, password: 'longenough1' }
  });
  assert.equal(first.status, 200);

  const second = await call(app, {
    method: 'POST',
    url: '/api/auth/register',
    body: { invitationToken: invite.token, password: 'differentpass1' }
  });
  assert.equal(second.status, 400);
  assert.match(second.json.error, /already been used/);
});

test('POST /api/admin/invites requires a super_admin session', async () => {
  const app = appWith();
  const res = await call(app, {
    method: 'POST',
    url: '/api/admin/invites',
    body: { email: 'new-admin@example.com', name: 'New Admin', role: 'admin' }
  });
  assert.equal(res.status, 401);
});

test('POST /api/admin/invites creates an invite and returns a working registration link', async () => {
  const app = appWith();
  const token = await createSuperAdminSession(app);

  const res = await call(app, {
    method: 'POST',
    url: '/api/admin/invites',
    headers: { authorization: `Bearer ${token}` },
    body: { email: 'new-admin@example.com', name: 'New Admin', role: 'admin' }
  });
  assert.equal(res.status, 200);
  assert.ok(res.json.token);
  assert.match(res.json.registrationLink, /\/register\?token=/);

  const status = await call(app, { method: 'GET', url: `/api/auth/invite-status?token=${res.json.token}` });
  assert.equal(status.json.valid, true);
});

test('POST /api/admin/accounts requires a super_admin session', async () => {
  const app = appWith();
  const res = await call(app, {
    method: 'POST',
    url: '/api/admin/accounts',
    body: { email: 'direct@example.com', name: 'Direct', role: 'admin', password: 'longenough1' }
  });
  assert.equal(res.status, 401);
});

test('POST /api/admin/accounts creates an active account immediately, no invite round trip', async () => {
  const app = appWith();
  const token = await createSuperAdminSession(app);

  const res = await call(app, {
    method: 'POST',
    url: '/api/admin/accounts',
    headers: { authorization: `Bearer ${token}` },
    body: { email: 'direct@example.com', name: 'Direct Admin', role: 'admin', password: 'longenough1' }
  });
  assert.equal(res.status, 200);

  const user = app.userAuth.getUserByEmail('direct@example.com');
  assert.ok(user);
  assert.equal(user.status, 'active');
  assert.equal(user.email_verified, 1);
  assert.doesNotThrow(() => app.userAuth.startLogin({ email: 'direct@example.com', password: 'longenough1' }));
});

test('POST /api/admin/accounts rejects role "officer" — website access is admin/super_admin only', async () => {
  const app = appWith();
  const token = await createSuperAdminSession(app);

  const res = await call(app, {
    method: 'POST',
    url: '/api/admin/accounts',
    headers: { authorization: `Bearer ${token}` },
    body: { email: 'officer-attempt@example.com', name: 'Nope', role: 'officer', password: 'longenough1' }
  });
  assert.equal(res.status, 400);
});
