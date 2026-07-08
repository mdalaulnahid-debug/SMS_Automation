'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
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

function appWith(registrationWindowEndsAt) {
  return createApp({
    dbPath: '',
    authDbPath: ':memory:',
    // A real (non-empty) adminApiKey is required here — an empty key makes
    // isAdmin() treat auth as disabled entirely ("dev/test" mode) and bypass
    // every role check, which would silently defeat the requireSuperAdmin
    // tests below. Never presented by any request in this file, so it only
    // serves to keep that bypass off.
    authConfig: { adminApiKey: 'unused-legacy-key', requireGatewayAuth: false, denyUnknownRequesters: false, registrationWindowEndsAt: registrationWindowEndsAt ?? null },
    gatewayConfig: {},
    mailConfig: {},
    bootstrapSuperAdmin: false
  });
}

// Registers, verifies (against whatever window policy is active), and logs in,
// returning a bearer token for the resulting session.
async function createSession(app, { email, role, pastWindow }) {
  // Registration now requires a Personnel Registry match (security-hardening
  // v1 step 5) — seed one covering this email/phone before registering.
  const phone = `017${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  app.userAuth.replaceRegistry(
    [...app.userAuth.listRegistry(), { name: 'Test User', phone, email }],
    'test-seed'
  );
  await call(app, {
    method: 'POST',
    url: '/api/auth/register',
    body: { email, password: 'longenough1', name: 'Test User', phone }
  });
  const user = app.userAuth.getUserByEmail(email);
  app.userAuth.verifyEmail(user.verify_token, {
    registrationWindowEndsAt: pastWindow ? new Date(Date.now() - 60_000).toISOString() : null
  });
  if (role) app.userAuth.setRole(user.id, role);
  if (app.userAuth.getUserByEmail(email).status === 'pending_approval') {
    app.userAuth.approveRegistration(user.id); // unblock login so tests can get a session regardless of role under test
  }

  const login = app.userAuth.startLogin({ email, password: 'longenough1' });
  const session = app.userAuth.completeLogin({ pendingToken: login.pendingToken, code: login.mfaCode });
  return { token: session.token, userId: user.id };
}

test('GET /api/admin/registrations/pending requires super_admin specifically, not just admin', async () => {
  const app = appWith();
  const admin = await createSession(app, { email: 'admin1@example.com', role: 'admin' });
  const superAdmin = await createSession(app, { email: 'super1@example.com', role: 'super_admin' });

  const asAdmin = await call(app, {
    method: 'GET',
    url: '/api/admin/registrations/pending',
    headers: { authorization: `Bearer ${admin.token}` }
  });
  assert.equal(asAdmin.status, 401, 'a plain admin session must not satisfy requireSuperAdmin');

  const asSuperAdmin = await call(app, {
    method: 'GET',
    url: '/api/admin/registrations/pending',
    headers: { authorization: `Bearer ${superAdmin.token}` }
  });
  assert.equal(asSuperAdmin.status, 200);
});

test('a pending_approval registration shows up in the queue and can be approved', async () => {
  const app = appWith();
  const superAdmin = await createSession(app, { email: 'super2@example.com', role: 'super_admin' });

  // Register someone AFTER the window has closed, so they land on pending_approval.
  app.userAuth.replaceRegistry(
    [...app.userAuth.listRegistry(), { name: 'Waiting Officer', phone: '01799999999', email: 'waiting@example.com' }],
    'test-seed'
  );
  await call(app, {
    method: 'POST',
    url: '/api/auth/register',
    body: { email: 'waiting@example.com', password: 'longenough1', name: 'Waiting Officer', phone: '01799999999' }
  });
  const waitingUser = app.userAuth.getUserByEmail('waiting@example.com');
  app.userAuth.verifyEmail(waitingUser.verify_token, { registrationWindowEndsAt: new Date(Date.now() - 60_000).toISOString() });

  const pendingList = await call(app, {
    method: 'GET',
    url: '/api/admin/registrations/pending',
    headers: { authorization: `Bearer ${superAdmin.token}` }
  });
  assert.equal(pendingList.json.registrations.length, 1);
  assert.equal(pendingList.json.registrations[0].email, 'waiting@example.com');

  const approve = await call(app, {
    method: 'POST',
    url: '/api/admin/registrations/approve',
    headers: { authorization: `Bearer ${superAdmin.token}` },
    body: { userId: waitingUser.id }
  });
  assert.equal(approve.status, 200);
  assert.equal(approve.json.user.status, 'active');

  // The queue should now be empty.
  const afterApprove = await call(app, {
    method: 'GET',
    url: '/api/admin/registrations/pending',
    headers: { authorization: `Bearer ${superAdmin.token}` }
  });
  assert.equal(afterApprove.json.registrations.length, 0);
});

test('approving without a userId is rejected', async () => {
  const app = appWith();
  const superAdmin = await createSession(app, { email: 'super3@example.com', role: 'super_admin' });
  const res = await call(app, {
    method: 'POST',
    url: '/api/admin/registrations/approve',
    headers: { authorization: `Bearer ${superAdmin.token}` },
    body: {}
  });
  assert.equal(res.status, 400);
});

test('GET/POST /api/admin/settings/registration-window round-trips and applies live without restart', async () => {
  // The POST handler writes to config/auth.json via settingsStore — sandbox
  // that to a temp file so this test never touches the real project config.
  const root = mkdtempSync(join(tmpdir(), 'registration-window-test-'));
  const authPath = join(root, 'auth.json');
  writeFileSync(authPath, JSON.stringify({ adminApiKey: '' }, null, 2));
  const prevAuthConfig = process.env.SMS_AUTH_CONFIG;
  process.env.SMS_AUTH_CONFIG = authPath;

  try {
    const app = appWith();
    const superAdmin = await createSession(app, { email: 'super4@example.com', role: 'super_admin' });

    const before = await call(app, {
      method: 'GET',
      url: '/api/admin/settings/registration-window',
      headers: { authorization: `Bearer ${superAdmin.token}` }
    });
    assert.equal(before.json.registrationWindowEndsAt, null);
    assert.equal(before.json.isOpen, true, 'no window configured means always open, by design');

    const future = new Date(Date.now() + 60_000).toISOString();
    const post = await call(app, {
      method: 'POST',
      url: '/api/admin/settings/registration-window',
      headers: { authorization: `Bearer ${superAdmin.token}` },
      body: { endsAt: future }
    });
    assert.equal(post.status, 200);
    assert.equal(post.json.registrationWindowEndsAt, future);

    // Applied immediately in-memory — confirmed through the real GET endpoint
    // (the source of truth an actual verify-email request would consult),
    // not by reaching into internals.
    const after = await call(app, {
      method: 'GET',
      url: '/api/admin/settings/registration-window',
      headers: { authorization: `Bearer ${superAdmin.token}` }
    });
    assert.equal(after.json.registrationWindowEndsAt, future, 'no restart should be needed to see the new value');
    assert.equal(after.json.isOpen, true, 'the window we just set is still in the future');
  } finally {
    if (prevAuthConfig === undefined) delete process.env.SMS_AUTH_CONFIG;
    else process.env.SMS_AUTH_CONFIG = prevAuthConfig;
    rmSync(root, { recursive: true, force: true });
  }
});

test('settings/registration-window endpoints require super_admin', async () => {
  const app = appWith();
  const res = await call(app, { method: 'GET', url: '/api/admin/settings/registration-window' });
  assert.equal(res.status, 401);
});
