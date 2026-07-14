'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApp } = require('../src/app');
const { UserAuthStore, isWithinRegistrationWindow } = require('../src/userAuth');

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

test('changePassword requires the current password and rejects a wrong one', () => {
  const store = new UserAuthStore(':memory:');
  const reg = store.register({ email: 'officer@example.com', password: 'longenough1', name: 'Officer One' });
  store.verifyEmail(reg.verifyToken);
  const login = store.startLogin({ email: 'officer@example.com', password: 'longenough1' });
  const session = store.completeLogin({ pendingToken: login.pendingToken, code: login.mfaCode });

  assert.throws(
    () => store.changePassword(session.user.id, 'wrongcurrent1', 'brandnewpass1'),
    /Current password is incorrect/
  );
  // Old password still works — a rejected attempt must not have side effects.
  assert.doesNotThrow(() => store.startLogin({ email: 'officer@example.com', password: 'longenough1' }));

  store.changePassword(session.user.id, 'longenough1', 'brandnewpass1');
  assert.throws(() => store.startLogin({ email: 'officer@example.com', password: 'longenough1' }), /Invalid email or password/);
  assert.doesNotThrow(() => store.startLogin({ email: 'officer@example.com', password: 'brandnewpass1' }));
});

test('changePassword rejects a new password shorter than 8 characters', () => {
  const store = new UserAuthStore(':memory:');
  const reg = store.register({ email: 'officer@example.com', password: 'longenough1', name: 'Officer One' });
  store.verifyEmail(reg.verifyToken);
  const login = store.startLogin({ email: 'officer@example.com', password: 'longenough1' });
  const session = store.completeLogin({ pendingToken: login.pendingToken, code: login.mfaCode });

  assert.throws(() => store.changePassword(session.user.id, 'longenough1', 'short1'), /at least 8 characters/);
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

// --- Identity unification (telegram_id) ---

test('register() accepts an optional telegramId and getUserByTelegramId finds it', () => {
  const store = new UserAuthStore(':memory:');
  const reg = store.register({ email: 'linked@example.com', password: 'longenough1', name: 'Linked', telegramId: '777888999' });
  const found = store.getUserByTelegramId('777888999');
  assert.equal(found.id, reg.id);
});

test('register() rejects a telegramId already linked to a different account', () => {
  const store = new UserAuthStore(':memory:');
  store.register({ email: 'first@example.com', password: 'longenough1', name: 'First', telegramId: '111' });
  assert.throws(
    () => store.register({ email: 'second@example.com', password: 'longenough1', name: 'Second', telegramId: '111' }),
    /already linked to another user/
  );
});

test('multiple accounts with no telegramId at all do not conflict with each other', () => {
  const store = new UserAuthStore(':memory:');
  // No telegramId passed for either — the partial unique index must allow any
  // number of NULLs, only non-null values need to be distinct.
  assert.doesNotThrow(() => {
    store.register({ email: 'nolink1@example.com', password: 'longenough1', name: 'NoLink1' });
    store.register({ email: 'nolink2@example.com', password: 'longenough1', name: 'NoLink2' });
  });
});

test('linkTelegramId attaches a Telegram identity to an existing account', () => {
  const store = new UserAuthStore(':memory:');
  const reg = store.register({ email: 'toLink@example.com', password: 'longenough1', name: 'To Link' });
  assert.equal(store.getUserByTelegramId('555'), null);

  store.linkTelegramId(reg.id, '555');
  const found = store.getUserByTelegramId('555');
  assert.equal(found.id, reg.id);
});

test('linkTelegramId rejects linking a Telegram ID already claimed by a different account', () => {
  const store = new UserAuthStore(':memory:');
  const first = store.register({ email: 'owner@example.com', password: 'longenough1', name: 'Owner' });
  store.linkTelegramId(first.id, '999');
  const second = store.register({ email: 'other@example.com', password: 'longenough1', name: 'Other' });

  assert.throws(() => store.linkTelegramId(second.id, '999'), /already linked to another user/);
});

test('linkTelegramId re-linking the SAME telegramId to the SAME user is a harmless no-op', () => {
  const store = new UserAuthStore(':memory:');
  const reg = store.register({ email: 'idempotent@example.com', password: 'longenough1', name: 'Idempotent' });
  store.linkTelegramId(reg.id, '333');
  assert.doesNotThrow(() => store.linkTelegramId(reg.id, '333'));
});

test('getUserByTelegramId returns null for an unlinked or unknown Telegram ID', () => {
  const store = new UserAuthStore(':memory:');
  assert.equal(store.getUserByTelegramId('nonexistent'), null);
  assert.equal(store.getUserByTelegramId(''), null);
  assert.equal(store.getUserByTelegramId(null), null);
});

test('migration adds telegram_id to a pre-existing auth_users table without it, preserving existing rows', () => {
  const { DatabaseSync } = require('node:sqlite');
  const path = require('node:path').join(require('node:os').tmpdir(), `auth-migration-test-${Date.now()}.db`);
  try {
    // Build the table in the OLD shape (no telegram_id) to simulate a real
    // deployment's DB file from before this column existed, then insert a row.
    const oldDb = new DatabaseSync(path);
    oldDb.exec(`
      CREATE TABLE auth_users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        name TEXT NOT NULL, phone TEXT, role TEXT NOT NULL DEFAULT 'officer',
        status TEXT NOT NULL DEFAULT 'pending_verification', email_verified INTEGER NOT NULL DEFAULT 0,
        verify_token TEXT, verify_token_expires_at TEXT, mfa_code_hash TEXT, mfa_code_expires_at TEXT,
        pending_session_token TEXT, created_at TEXT NOT NULL, last_login_at TEXT
      );
      CREATE TABLE auth_sessions (
        token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL, ip TEXT, user_agent TEXT
      );
    `);
    oldDb.prepare(
      `INSERT INTO auth_users (id, email, password_hash, name, role, status, email_verified, created_at)
       VALUES ('pre-existing-id', 'preexisting@example.com', 'hash', 'Pre Existing', 'officer', 'active', 1, '2026-01-01T00:00:00.000Z')`
    ).run();
    oldDb.close();

    // Opening it through UserAuthStore must migrate in place, not fail or drop data.
    const store = new UserAuthStore(path);
    const migrated = store.getUserByEmail('preexisting@example.com');
    assert.equal(migrated.name, 'Pre Existing', 'the pre-existing row must survive the migration');
    assert.equal(migrated.telegram_id, null, 'the new column should default to null on old rows');

    // And the new functionality works immediately after migrating.
    store.linkTelegramId(migrated.id, '42');
    assert.equal(store.getUserByTelegramId('42').id, migrated.id);
    store.close();
  } finally {
    require('node:fs').rmSync(path, { force: true });
    require('node:fs').rmSync(`${path}-wal`, { force: true });
    require('node:fs').rmSync(`${path}-shm`, { force: true });
  }
});

// --- Personnel Registry persistence ---

test('replaceRegistry stores records and listRegistry returns them sorted by name', () => {
  const store = new UserAuthStore(':memory:');
  const result = store.replaceRegistry([
    { name: 'Zulfiqar', phone: '01700000001', email: 'z@example.com' },
    { name: 'Amina', phone: '01700000002', email: 'a@example.com' }
  ], 'admin-1');

  assert.equal(result.count, 2);
  assert.equal(store.registrySize(), 2);
  const rows = store.listRegistry();
  assert.deepEqual(rows.map((r) => r.name), ['Amina', 'Zulfiqar'], 'must be sorted by name');
  assert.equal(rows[0].imported_by, 'admin-1');
});

test('replaceRegistry wholesale-replaces — a second import wipes the first', () => {
  const store = new UserAuthStore(':memory:');
  store.replaceRegistry([{ name: 'Old', phone: '01700000001', email: 'old@example.com' }], 'admin-1');
  assert.equal(store.registrySize(), 1);

  store.replaceRegistry([{ name: 'New', phone: '01700000002', email: 'new@example.com' }], 'admin-1');
  const rows = store.listRegistry();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'New', 'the old roster must be gone, not merged with the new one');
});

test('a failed import rolls back — the previous registry survives intact', () => {
  const store = new UserAuthStore(':memory:');
  store.replaceRegistry([{ name: 'Survivor', phone: '01700000001', email: 'survivor@example.com' }], 'admin-1');

  const poisonedRecord = {
    // String(poisonedRecord.name || '') will call toString(), which throws —
    // simulates a bad record blowing up partway through the insert loop.
    name: { toString() { throw new Error('boom'); } },
    phone: '01700000002',
    email: 'bad@example.com'
  };
  assert.throws(() => store.replaceRegistry([poisonedRecord], 'admin-1'), /boom/);

  // The DELETE FROM personnel_registry at the start of the failed attempt
  // must have been rolled back along with the failed insert.
  const rows = store.listRegistry();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Survivor');
});

test('buildPersonnelRegistry returns a working matcher built from the persisted roster', () => {
  const store = new UserAuthStore(':memory:');
  store.replaceRegistry([{ name: 'SI Nazmul', phone: '01712345678', email: 'nazmul@police.gov.bd' }], 'admin-1');

  const registry = store.buildPersonnelRegistry();
  const match = registry.matchByPhoneAndEmail('01712345678', 'nazmul@police.gov.bd');
  assert.equal(match.name, 'SI Nazmul');
  assert.equal(registry.matchByPhoneAndEmail('01712345678', 'wrong@example.com'), null);
});

test('addRegistryRecord adds one record without touching the rest of the roster', () => {
  const store = new UserAuthStore(':memory:');
  store.replaceRegistry([{ name: 'SI Nazmul', phone: '01712345678', email: 'nazmul@police.gov.bd' }], 'admin-1');
  const added = store.addRegistryRecord({ name: 'SI Karim', designation: 'Sub-Inspector', unit: 'Bakerganj', phone: '01799999999', email: 'karim@police.gov.bd' }, 'super1@example.com');
  assert.equal(added.name, 'SI Karim');
  assert.equal(store.registrySize(), 2);
  assert.ok(store.buildPersonnelRegistry().matchByPhoneAndEmail('01712345678', 'nazmul@police.gov.bd'), 'existing record untouched');
});

test('addRegistryRecord rejects an exact (phone, email) duplicate', () => {
  const store = new UserAuthStore(':memory:');
  store.addRegistryRecord({ name: 'SI Nazmul', phone: '01712345678', email: 'nazmul@police.gov.bd' }, 'admin');
  assert.throws(() => store.addRegistryRecord({ name: 'Someone Else', phone: '01712345678', email: 'nazmul@police.gov.bd' }, 'admin'), /already exists/);
});

test('addRegistryRecord requires name, phone, and a valid email', () => {
  const store = new UserAuthStore(':memory:');
  assert.throws(() => store.addRegistryRecord({ phone: '01712345678', email: 'a@example.com' }, 'admin'), /Name is required/);
  assert.throws(() => store.addRegistryRecord({ name: 'X', email: 'a@example.com' }, 'admin'), /Phone is required/);
  assert.throws(() => store.addRegistryRecord({ name: 'X', phone: '01712345678', email: 'not-an-email' }, 'admin'), /Invalid email/);
});

test('an empty registry is valid (no records imported yet)', () => {
  const store = new UserAuthStore(':memory:');
  assert.equal(store.registrySize(), 0);
  assert.deepEqual(store.listRegistry(), []);
  assert.equal(store.buildPersonnelRegistry().matchByPhoneAndEmail('01700000000', 'a@example.com'), null);
});

test('register persists designation and unit', () => {
  const store = new UserAuthStore(':memory:');
  store.register({ email: 'd1@example.com', password: 'longenough1', name: 'SI Ahmed', designation: 'Sub-Inspector', unit: 'LIC Barishal' });
  const user = store.getUserByEmail('d1@example.com');
  assert.equal(user.designation, 'Sub-Inspector');
  assert.equal(user.unit, 'LIC Barishal');
});

// --- Registration-link tokens (design doc §5) ---

test('createRegistrationToken then consumeRegistrationToken round-trips the telegramId', () => {
  const store = new UserAuthStore(':memory:');
  const { token } = store.createRegistrationToken('555111');
  const telegramId = store.consumeRegistrationToken(token);
  assert.equal(telegramId, '555111');
});

test('consumeRegistrationToken rejects an unknown token', () => {
  const store = new UserAuthStore(':memory:');
  assert.throws(() => store.consumeRegistrationToken('not-a-real-token'), /Invalid or expired/);
});

test('consumeRegistrationToken rejects a token that has already been used', () => {
  const store = new UserAuthStore(':memory:');
  const { token } = store.createRegistrationToken('555222');
  store.consumeRegistrationToken(token);
  assert.throws(() => store.consumeRegistrationToken(token), /already been used/);
});

test('consumeRegistrationToken rejects an expired token', () => {
  const store = new UserAuthStore(':memory:');
  const now = Date.now();
  const { token } = store.createRegistrationToken('555333', { now, ttlMs: 1000 });
  assert.throws(() => store.consumeRegistrationToken(token, { now: now + 2000 }), /expired/);
});

test('createRegistrationToken called twice for the same telegramId re-issues rather than accumulating rows — the old token stops working', () => {
  const store = new UserAuthStore(':memory:');
  const first = store.createRegistrationToken('555444');
  const second = store.createRegistrationToken('555444');
  assert.notEqual(first.token, second.token);
  assert.throws(() => store.consumeRegistrationToken(first.token), /Invalid or expired/);
  assert.equal(store.consumeRegistrationToken(second.token), '555444');
});

// --- Registration activation policy (design doc §3) ---

test('isWithinRegistrationWindow: no window configured means always auto-activate (default, backward compatible)', () => {
  assert.equal(isWithinRegistrationWindow(null), true);
  assert.equal(isWithinRegistrationWindow(undefined), true);
  assert.equal(isWithinRegistrationWindow(''), true);
});

test('isWithinRegistrationWindow: true while the end date is in the future, false once past', () => {
  const now = new Date('2026-07-07T12:00:00.000Z').getTime();
  assert.equal(isWithinRegistrationWindow('2026-07-14T00:00:00.000Z', now), true);
  assert.equal(isWithinRegistrationWindow('2026-07-01T00:00:00.000Z', now), false);
});

test('verifyEmail activates immediately when no window is configured (default)', () => {
  const store = new UserAuthStore(':memory:');
  const reg = store.register({ email: 'nowindow@example.com', password: 'longenough1', name: 'No Window' });
  const user = store.verifyEmail(reg.verifyToken);
  assert.equal(user.status, 'active');
});

test('verifyEmail activates immediately while inside an active migration window', () => {
  const store = new UserAuthStore(':memory:');
  const reg = store.register({ email: 'inwindow@example.com', password: 'longenough1', name: 'In Window' });
  const future = new Date(Date.now() + 60_000).toISOString();
  const user = store.verifyEmail(reg.verifyToken, { registrationWindowEndsAt: future });
  assert.equal(user.status, 'active');
});

test('verifyEmail lands on pending_approval once the migration window has closed', () => {
  const store = new UserAuthStore(':memory:');
  const reg = store.register({ email: 'postwindow@example.com', password: 'longenough1', name: 'Post Window' });
  const past = new Date(Date.now() - 60_000).toISOString();
  const user = store.verifyEmail(reg.verifyToken, { registrationWindowEndsAt: past });
  assert.equal(user.status, 'pending_approval');
});

test('a pending_approval account cannot log in until approved', () => {
  const store = new UserAuthStore(':memory:');
  const reg = store.register({ email: 'waiting@example.com', password: 'longenough1', name: 'Waiting' });
  const past = new Date(Date.now() - 60_000).toISOString();
  store.verifyEmail(reg.verifyToken, { registrationWindowEndsAt: past });

  assert.throws(
    () => store.startLogin({ email: 'waiting@example.com', password: 'longenough1' }),
    /pending administrator approval/
  );

  store.approveRegistration(reg.id);
  assert.doesNotThrow(() => store.startLogin({ email: 'waiting@example.com', password: 'longenough1' }));
});

test('listPendingApprovals returns only pending_approval accounts', () => {
  const store = new UserAuthStore(':memory:');
  const past = new Date(Date.now() - 60_000).toISOString();

  const pending = store.register({ email: 'pending@example.com', password: 'longenough1', name: 'Pending' });
  store.verifyEmail(pending.verifyToken, { registrationWindowEndsAt: past });

  const active = store.register({ email: 'active@example.com', password: 'longenough1', name: 'Active' });
  store.verifyEmail(active.verifyToken); // no window -> active immediately

  const list = store.listPendingApprovals();
  assert.equal(list.length, 1);
  assert.equal(list[0].email, 'pending@example.com');
});

test('approveRegistration rejects a user not currently in pending_approval', () => {
  const store = new UserAuthStore(':memory:');
  const reg = store.register({ email: 'alreadyactive@example.com', password: 'longenough1', name: 'Already Active' });
  store.verifyEmail(reg.verifyToken); // -> active, no window
  assert.throws(() => store.approveRegistration(reg.id), /expected pending_approval/);
});

test('approveRegistration rejects an unknown user id', () => {
  const store = new UserAuthStore(':memory:');
  assert.throws(() => store.approveRegistration('nonexistent-id'), /User not found/);
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
  // Registration now requires a Personnel Registry match (security-hardening v1 step 5).
  app.userAuth.replaceRegistry([{ name: 'Officer One', phone: '01712340000', email: 'officer@example.com' }], 'test-seed');

  const register = await call(app, {
    method: 'POST',
    url: '/api/auth/register',
    body: { email: 'officer@example.com', password: 'longenough1', name: 'Officer One', phone: '01712340000' }
  });
  assert.equal(register.status, 200);

  const user = app.userAuth.getUserByEmail('officer@example.com');
  const verify = await call(app, { method: 'GET', url: `/verify-email?token=${user.verify_token}` });
  assert.equal(verify.status, 302); // redirects to /login.html?verified=1

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
  assert.deepEqual(
    Object.keys(me.json.user).sort(),
    ['createdAt', 'designation', 'email', 'id', 'name', 'phone', 'role', 'status', 'telegramLinked', 'unit'].sort(),
    '/api/auth/me must only ever expose this allowlist — password_hash, verify_token, mfa_code_hash, and pending_session_token must never appear'
  );
  assert.equal(me.json.user.password_hash, undefined);

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
