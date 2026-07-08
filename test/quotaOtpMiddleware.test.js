'use strict';

// Integration tests for the quota + OTP re-verification middleware wired
// into POST /api/requests and POST /api/telegram/verify-code
// (security-hardening v1 step 6, design doc §7). The pure logic itself
// (QuotaTracker, OtpStore) is unit-tested in test/quota.test.js and
// test/otp.test.js — this file covers the wiring: wrong requests get
// blocked, the right ones don't, and verifying reopens the window.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApp } = require('../src/app');
const { QuotaTracker } = require('../src/quota');
const { OtpStore } = require('../src/otp');

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

function appWith({ quotaTracker, otpStore } = {}) {
  return createApp({
    dbPath: '',
    authDbPath: ':memory:',
    authConfig: { adminApiKey: 'topsecret', requireGatewayAuth: false, denyUnknownRequesters: false },
    gatewayConfig: { GP: { secret: 'gp-secret', trustedSenders: ['12345'] } },
    mailConfig: {},
    bootstrapSuperAdmin: false,
    quotaTracker,
    otpStore
  });
}

function createLinkedOfficer(app, { email, telegramId, phone = '01799990000' }) {
  const reg = app.userAuth.register({ email, password: 'longenough1', name: 'Officer QA', phone, role: 'officer', telegramId });
  app.userAuth.verifyEmail(reg.verifyToken, {});
  return app.userAuth.getUserByEmail(email);
}

function submitAs(app, telegramId, text) {
  return call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { requesterId: telegramId, requesterName: 'Officer QA', text }
  });
}

test('a request from a telegramId with no linked officer account is never quota-gated', async () => {
  const quotaTracker = new QuotaTracker({ maxRequests: 1 });
  const app = appWith({ quotaTracker });
  const first = await submitAs(app, '999888', 'LRL 01712345678');
  const second = await submitAs(app, '999888', 'LRL 01712345679');
  assert.notEqual(first.json.errorCode, 'VERIFICATION_REQUIRED');
  assert.notEqual(second.json.errorCode, 'VERIFICATION_REQUIRED', 'no linked officer means the quota tracker never applies, even past what would be the limit');
});

test('a linked officer is blocked once the quota trips, and unblocked after the correct OTP reply', async () => {
  const quotaTracker = new QuotaTracker({ maxRequests: 2 });
  const otpStore = new OtpStore();
  const app = appWith({ quotaTracker, otpStore });
  const officer = createLinkedOfficer(app, { email: 'quota-officer@example.com', telegramId: '555111' });

  const first = await submitAs(app, '555111', 'LRL 01712345671');
  const second = await submitAs(app, '555111', 'LRL 01712345672');
  assert.notEqual(first.json.errorCode, 'VERIFICATION_REQUIRED');
  assert.notEqual(second.json.errorCode, 'VERIFICATION_REQUIRED');

  const third = await submitAs(app, '555111', 'LRL 01712345673');
  assert.equal(third.status, 400);
  assert.equal(third.json.errorCode, 'VERIFICATION_REQUIRED');
  assert.match(third.json.replyText, /verification code was sent/i);

  // Further requests while the challenge is still pending stay blocked, and
  // do not re-issue a second code (still the SAME pending-challenge message).
  const fourth = await submitAs(app, '555111', 'LRL 01712345674');
  assert.equal(fourth.json.errorCode, 'VERIFICATION_REQUIRED');
  assert.match(fourth.json.replyText, /already have a pending/i);

  // Read the real code the way the OTP store issued it — this is the
  // equivalent of "the officer read it from their email".
  const challenge = otpStore.challenges.get(officer.id);
  assert.ok(challenge, 'a challenge should be active for this officer');

  const wrongCode = challenge.code === '000000' ? '111111' : '000000';
  const wrongVerify = await call(app, {
    method: 'POST',
    url: '/api/telegram/verify-code',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { telegramId: '555111', code: wrongCode }
  });
  assert.equal(wrongVerify.json.ok, false);
  assert.equal(wrongVerify.json.reason, 'INCORRECT');

  const verify = await call(app, {
    method: 'POST',
    url: '/api/telegram/verify-code',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { telegramId: '555111', code: challenge.code }
  });
  assert.equal(verify.json.ok, true);

  // Quota window is reset — the officer can submit again.
  const afterVerify = await submitAs(app, '555111', 'LRL 01712345675');
  assert.notEqual(afterVerify.json.errorCode, 'VERIFICATION_REQUIRED');
});

test('POST /api/telegram/verify-code requires admin auth', async () => {
  const app = appWith();
  const res = await call(app, {
    method: 'POST',
    url: '/api/telegram/verify-code',
    body: { telegramId: '1', code: '123456' }
  });
  assert.equal(res.status, 401);
});

test('POST /api/telegram/verify-code reports NO_ACTIVE_CHALLENGE for an unlinked telegramId', async () => {
  const app = appWith();
  const res = await call(app, {
    method: 'POST',
    url: '/api/telegram/verify-code',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { telegramId: 'never-registered', code: '123456' }
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, false);
  assert.equal(res.json.reason, 'NO_ACTIVE_CHALLENGE');
});

test('POST /api/telegram/verify-code requires both telegramId and code', async () => {
  const app = appWith();
  const res = await call(app, {
    method: 'POST',
    url: '/api/telegram/verify-code',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { telegramId: '1' }
  });
  assert.equal(res.status, 400);
});
