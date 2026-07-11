'use strict';

// Integration tests for the behavioral anomaly tripwire wired into
// POST /api/requests and surfaced via GET /api/admin/overview
// (security-hardening v1 step 9, design doc §11). The pure detector logic
// itself is unit-tested in test/anomalyDetector.test.js — this file covers
// the wiring: flags get audited without blocking the request, and admins
// can see them.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApp } = require('../src/app');
const { AnomalyDetector } = require('../src/anomalyDetector');

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

function appWith({ anomalyDetector } = {}) {
  return createApp({
    dbPath: '',
    authDbPath: ':memory:',
    authConfig: { adminApiKey: 'topsecret', requireGatewayAuth: false, denyUnknownRequesters: false },
    gatewayConfig: { GP: { secret: 'gp-secret', trustedSenders: ['12345'] } },
    mailConfig: {},
    bootstrapSuperAdmin: false,
    anomalyDetector
  });
}

function createLinkedOfficer(app, { email, telegramId, phone = '01799990000' }) {
  const reg = app.userAuth.register({ email, password: 'longenough1', name: 'Officer QA', phone, role: 'officer', telegramId });
  app.userAuth.verifyEmail(reg.verifyToken, {});
  return app.userAuth.getUserByEmail(email);
}

test('a flagged (off-hours) submission from a linked officer is audited but not blocked', async () => {
  // The tripwire uses server receipt time (never a client-suppliable field —
  // trusting a caller's own timestamp for an off-hours check would let an
  // attacker simply lie about it), so the test controls "now" via the
  // detector's injected clock, not the request body.
  const midnightBst = new Date('2026-07-08T18:00:00.000Z').getTime(); // 00:00 BST
  const anomalyDetector = new AnomalyDetector({ now: () => midnightBst });
  const app = appWith({ anomalyDetector });
  createLinkedOfficer(app, { email: 'anomaly-off-hours@example.com', telegramId: '111222' });

  const res = await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { requesterId: '111222', requesterName: 'Officer QA', text: 'LRL 01712345671' }
  });
  // Never blocked — the tripwire is a soft net, response is unaffected either way.
  assert.equal(res.status, 201);

  const audit = app.store.auditLogs.filter((row) => row.action === 'BEHAVIORAL_ANOMALY_FLAGGED');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].details.flagType, 'OFF_HOURS_SUBMISSION');
  assert.equal(audit[0].actor, 'anomaly-off-hours@example.com');
});

test('a request from an unlinked telegramId never trips the tripwire', async () => {
  const midnightBst = new Date('2026-07-08T18:00:00.000Z').getTime();
  const anomalyDetector = new AnomalyDetector({ now: () => midnightBst });
  const app = appWith({ anomalyDetector });
  await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { requesterId: 'never-linked', requesterName: 'Stranger', text: 'LRL 01712345671' }
  });
  assert.equal(app.store.auditLogs.filter((row) => row.action === 'BEHAVIORAL_ANOMALY_FLAGGED').length, 0);
});

test('a burst of requests from a linked officer trips the tripwire without blocking any of them', async () => {
  const anomalyDetector = new AnomalyDetector({ burstThreshold: 2, burstWindowMs: 60_000 });
  const app = appWith({ anomalyDetector });
  createLinkedOfficer(app, { email: 'anomaly-burst@example.com', telegramId: '333444' });

  for (let i = 0; i < 3; i++) {
    const res = await call(app, {
      method: 'POST',
      url: '/api/requests',
      headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
      body: { requesterId: '333444', requesterName: 'Officer QA', text: `LRL 0171234567${i}` }
    });
    assert.equal(res.status, 201, `request ${i + 1} must still succeed`);
  }
  const bursts = app.store.auditLogs.filter((row) => row.action === 'BEHAVIORAL_ANOMALY_FLAGGED' && row.details.flagType === 'BURST_VOLUME');
  assert.equal(bursts.length, 1, 'only the 3rd request crosses the threshold of 2');
});

test('a quota-blocked request still feeds the tripwire (no requestType, but timing/volume still count)', async () => {
  const { QuotaTracker } = require('../src/quota');
  const midnightBst = new Date('2026-07-08T18:00:00.000Z').getTime();
  const anomalyDetector = new AnomalyDetector({ now: () => midnightBst });
  const quotaTracker = new QuotaTracker({ maxRequests: 1 });
  const app = createApp({
    dbPath: '',
    authDbPath: ':memory:',
    authConfig: { adminApiKey: 'topsecret', requireGatewayAuth: false, denyUnknownRequesters: false },
    gatewayConfig: { GP: { secret: 'gp-secret', trustedSenders: ['12345'] } },
    mailConfig: {},
    bootstrapSuperAdmin: false,
    anomalyDetector,
    quotaTracker
  });
  createLinkedOfficer(app, { email: 'anomaly-quota@example.com', telegramId: '555666' });

  await call(app, {
    method: 'POST', url: '/api/requests',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { requesterId: '555666', requesterName: 'Officer QA', text: 'LRL 01712345671' }
  });
  // Second request breaches quota (max 1) — still off-hours, still worth flagging.
  const blocked = await call(app, {
    method: 'POST', url: '/api/requests',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { requesterId: '555666', requesterName: 'Officer QA', text: 'LRL 01712345672' }
  });
  assert.equal(blocked.json.errorCode, 'VERIFICATION_REQUIRED');

  const offHoursFlags = app.store.auditLogs.filter((row) => row.action === 'BEHAVIORAL_ANOMALY_FLAGGED' && row.details.flagType === 'OFF_HOURS_SUBMISSION');
  assert.equal(offHoursFlags.length, 2, 'both attempts (including the quota-blocked one) should be flagged off-hours');
});

test('GET /api/admin/overview surfaces behavioralAnomalies24h and recentAnomalyFlags', async () => {
  const midnightBst = new Date('2026-07-08T18:00:00.000Z').getTime();
  const anomalyDetector = new AnomalyDetector({ now: () => midnightBst });
  const app = appWith({ anomalyDetector });
  createLinkedOfficer(app, { email: 'anomaly-overview@example.com', telegramId: '777888' });

  await call(app, {
    method: 'POST', url: '/api/requests',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { requesterId: '777888', requesterName: 'Officer QA', text: 'LRL 01712345671' }
  });

  const res = await call(app, { method: 'GET', url: '/api/admin/overview', headers: { 'x-api-key': 'topsecret' } });
  assert.equal(res.status, 200);
  assert.equal(res.json.stats.behavioralAnomalies24h, 1);
  assert.equal(res.json.diagnostics.recentAnomalyFlags.length, 1);
  assert.equal(res.json.diagnostics.recentAnomalyFlags[0].flagType, 'OFF_HOURS_SUBMISSION');
  assert.equal(res.json.diagnostics.recentAnomalyFlags[0].officerEmail, 'anomaly-overview@example.com');
});
