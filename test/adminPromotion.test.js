'use strict';

// Integration tests for the promote-officer-to-admin flow (security-hardening
// v1 follow-on): GET /api/admin/users and POST /api/admin/users/:id/role.
// Both are super_admin-session-only by design — the legacy shared key must
// not satisfy them, matching every other owner-only action (registry-record-
// add, registration-window). Promotion only ever draws from already-
// registered accounts; super_admin is never a settable target through this
// endpoint.

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
    gatewayConfig: { GP: { secret: 'gp-secret', trustedSenders: ['12345'] } },
    mailConfig: {},
    bootstrapSuperAdmin: false
  });
}

// Creates the account directly (bypassing the now invite-gated HTTP
// register endpoint, same as every other test file after the access-model
// correction). An officer-role account can no longer log in at all
// (userAuth.startLogin blocks it) — callers that need an officer only for
// its user record (as a promote/demote target, never as an actor) get
// token: null back instead of throwing.
async function createSessionAs(app, { email, role }) {
  const user = app.userAuth.createVerifiedUser({ email, password: 'longenough1', name: 'Test User', role: role || 'officer' });
  try {
    // super_admin can only complete login via startSuperAdminLogin (the
    // hidden gate) — every other role uses the ordinary startLogin.
    const login = role === 'super_admin'
      ? app.userAuth.startSuperAdminLogin({ email, password: 'longenough1' })
      : app.userAuth.startLogin({ email, password: 'longenough1' });
    const session = app.userAuth.completeLogin({ pendingToken: login.pendingToken, code: login.mfaCode });
    return { token: session.token, user: app.userAuth.getUserByEmail(email) };
  } catch {
    return { token: null, user: app.userAuth.getUserByEmail(email) };
  }
}

test('GET /api/admin/users rejects the legacy admin key and a plain admin session, only super_admin gets in', async () => {
  const app = appWith();

  const withKey = await call(app, { method: 'GET', url: '/api/admin/users', headers: { 'x-api-key': 'topsecret' } });
  assert.equal(withKey.status, 401);

  const { token: adminToken } = await createSessionAs(app, { email: 'plain-admin@example.com', role: 'admin' });
  const withAdmin = await call(app, { method: 'GET', url: '/api/admin/users', headers: { authorization: `Bearer ${adminToken}` } });
  assert.equal(withAdmin.status, 401);

  const { token: superToken } = await createSessionAs(app, { email: 'super@example.com', role: 'super_admin' });
  const withSuper = await call(app, { method: 'GET', url: '/api/admin/users', headers: { authorization: `Bearer ${superToken}` } });
  assert.equal(withSuper.status, 200);
  assert.ok(Array.isArray(withSuper.json.users));
  assert.ok(withSuper.json.users.some((u) => u.email === 'super@example.com'));
});

test('a super_admin can promote a registered officer to admin, and demote them back', async () => {
  const app = appWith();
  const { token: superToken } = await createSessionAs(app, { email: 'owner@example.com', role: 'super_admin' });
  const { user: officer } = await createSessionAs(app, { email: 'officer@example.com', role: 'officer' });

  const promote = await call(app, {
    method: 'POST',
    url: `/api/admin/users/${officer.id}/role`,
    headers: { authorization: `Bearer ${superToken}`, 'content-type': 'application/json' },
    body: { role: 'admin' }
  });
  assert.equal(promote.status, 200);
  assert.equal(promote.json.previousRole, 'officer');
  assert.equal(promote.json.newRole, 'admin');
  assert.equal(app.userAuth.getUserById(officer.id).role, 'admin');

  const demote = await call(app, {
    method: 'POST',
    url: `/api/admin/users/${officer.id}/role`,
    headers: { authorization: `Bearer ${superToken}`, 'content-type': 'application/json' },
    body: { role: 'officer' }
  });
  assert.equal(demote.status, 200);
  assert.equal(app.userAuth.getUserById(officer.id).role, 'officer');
});

test('promotion is rejected for a non-super_admin session', async () => {
  const app = appWith();
  const { token: adminToken } = await createSessionAs(app, { email: 'plain-admin2@example.com', role: 'admin' });
  const { user: officer } = await createSessionAs(app, { email: 'officer2@example.com', role: 'officer' });

  const res = await call(app, {
    method: 'POST',
    url: `/api/admin/users/${officer.id}/role`,
    headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: { role: 'admin' }
  });
  assert.equal(res.status, 401);
  assert.equal(app.userAuth.getUserById(officer.id).role, 'officer');
});

test('the endpoint refuses to set role to super_admin', async () => {
  const app = appWith();
  const { token: superToken } = await createSessionAs(app, { email: 'owner2@example.com', role: 'super_admin' });
  const { user: officer } = await createSessionAs(app, { email: 'officer3@example.com', role: 'officer' });

  const res = await call(app, {
    method: 'POST',
    url: `/api/admin/users/${officer.id}/role`,
    headers: { authorization: `Bearer ${superToken}`, 'content-type': 'application/json' },
    body: { role: 'super_admin' }
  });
  assert.equal(res.status, 400);
  assert.equal(app.userAuth.getUserById(officer.id).role, 'officer');
});

test('a super_admin cannot change their own role', async () => {
  const app = appWith();
  const { token: superToken, user: owner } = await createSessionAs(app, { email: 'owner3@example.com', role: 'super_admin' });

  const res = await call(app, {
    method: 'POST',
    url: `/api/admin/users/${owner.id}/role`,
    headers: { authorization: `Bearer ${superToken}`, 'content-type': 'application/json' },
    body: { role: 'admin' }
  });
  assert.equal(res.status, 400);
  assert.equal(app.userAuth.getUserById(owner.id).role, 'super_admin');
});

test('the endpoint refuses to change an existing super_admin\'s role even by id, not just self', async () => {
  const app = appWith();
  const { token: superToken } = await createSessionAs(app, { email: 'owner4@example.com', role: 'super_admin' });
  const { user: secondSuper } = await createSessionAs(app, { email: 'owner5@example.com', role: 'super_admin' });

  const res = await call(app, {
    method: 'POST',
    url: `/api/admin/users/${secondSuper.id}/role`,
    headers: { authorization: `Bearer ${superToken}`, 'content-type': 'application/json' },
    body: { role: 'officer' }
  });
  assert.equal(res.status, 400);
  assert.equal(app.userAuth.getUserById(secondSuper.id).role, 'super_admin');
});

test('promoting an officer is audit-logged', async () => {
  const app = appWith();
  const { token: superToken } = await createSessionAs(app, { email: 'owner6@example.com', role: 'super_admin' });
  const { user: officer } = await createSessionAs(app, { email: 'officer4@example.com', role: 'officer' });

  await call(app, {
    method: 'POST',
    url: `/api/admin/users/${officer.id}/role`,
    headers: { authorization: `Bearer ${superToken}`, 'content-type': 'application/json' },
    body: { role: 'admin' }
  });

  const row = app.store.auditLogs.find((r) => r.action === 'USER_ROLE_CHANGED' && r.details && r.details.userId === officer.id);
  assert.ok(row, 'expected a USER_ROLE_CHANGED audit row');
  assert.equal(row.details.previousRole, 'officer');
  assert.equal(row.details.newRole, 'admin');
});
