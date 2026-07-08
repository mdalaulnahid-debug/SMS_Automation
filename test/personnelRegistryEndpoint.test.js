'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApp } = require('../src/app');

function mockReq({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const payload = body === undefined ? '' : Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body);
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
  return { status: res.statusCode, headers: res.headers, json };
}

function appWith() {
  return createApp({
    dbPath: '',
    authDbPath: ':memory:',
    authConfig: { adminApiKey: 'topsecret', requireGatewayAuth: false, denyUnknownRequesters: false },
    gatewayConfig: {},
    mailConfig: {},
    bootstrapSuperAdmin: false
  });
}

function xlsxBufferFromRows(rows) {
  const xlsx = require('xlsx');
  const sheet = xlsx.utils.aoa_to_sheet(rows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

test('GET /api/admin/personnel-registry requires admin auth', async () => {
  const app = appWith();
  const res = await call(app, { method: 'GET', url: '/api/admin/personnel-registry' });
  assert.equal(res.status, 401);
});

test('POST /api/admin/personnel-registry/import requires admin auth', async () => {
  const app = appWith();
  const buffer = xlsxBufferFromRows([['Name', 'Phone', 'Email'], ['A', '01700000001', 'a@example.com']]);
  const res = await call(app, {
    method: 'POST',
    url: '/api/admin/personnel-registry/import',
    body: buffer
  });
  assert.equal(res.status, 401);
});

test('importing a valid workbook populates the registry, visible via GET', async () => {
  const app = appWith();
  const buffer = xlsxBufferFromRows([
    ['Name', 'Designation', 'Unit', 'Phone', 'Email'],
    ['SI Nazmul', 'Sub-Inspector', 'Bakerganj', '01712345678', 'nazmul@police.gov.bd']
  ]);

  const importRes = await call(app, {
    method: 'POST',
    url: '/api/admin/personnel-registry/import',
    headers: { 'x-api-key': 'topsecret' },
    body: buffer
  });
  assert.equal(importRes.status, 200);
  assert.equal(importRes.json.count, 1);

  const listRes = await call(app, {
    method: 'GET',
    url: '/api/admin/personnel-registry',
    headers: { 'x-api-key': 'topsecret' }
  });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.json.count, 1);
  assert.equal(listRes.json.records[0].name, 'SI Nazmul');
});

test('importing a workbook missing required columns returns a clear 400, does not touch the registry', async () => {
  const app = appWith();
  // Seed a real registry first, so we can confirm the bad import doesn't wipe it.
  await call(app, {
    method: 'POST',
    url: '/api/admin/personnel-registry/import',
    headers: { 'x-api-key': 'topsecret' },
    body: xlsxBufferFromRows([['Name', 'Phone', 'Email'], ['Existing', '01700000009', 'existing@example.com']])
  });

  const badRes = await call(app, {
    method: 'POST',
    url: '/api/admin/personnel-registry/import',
    headers: { 'x-api-key': 'topsecret' },
    body: xlsxBufferFromRows([['Name', 'Designation'], ['No Contact Info', 'Rank']])
  });
  assert.equal(badRes.status, 400);
  assert.match(badRes.json.error, /must have Name, Phone, and Email columns/);

  const listRes = await call(app, {
    method: 'GET',
    url: '/api/admin/personnel-registry',
    headers: { 'x-api-key': 'topsecret' }
  });
  assert.equal(listRes.json.count, 1, 'the previously-imported registry must be untouched by the failed import');
  assert.equal(listRes.json.records[0].name, 'Existing');
});

test('an empty/all-invalid workbook is rejected rather than wiping the registry with zero records', async () => {
  const app = appWith();
  const res = await call(app, {
    method: 'POST',
    url: '/api/admin/personnel-registry/import',
    headers: { 'x-api-key': 'topsecret' },
    body: xlsxBufferFromRows([['Name', 'Phone', 'Email']]) // headers only, no data rows
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /No valid records/);
});

// --- POST /api/admin/personnel-registry/add (single-record, super_admin-only) ---

async function createSession(app, { email, role }) {
  app.userAuth.replaceRegistry(
    [...app.userAuth.listRegistry(), { name: 'Test User', phone: '01700000001', email }],
    'test-seed'
  );
  await call(app, { method: 'POST', url: '/api/auth/register', body: { email, password: 'longenough1', name: 'Test User', phone: '01700000001' } });
  const user = app.userAuth.getUserByEmail(email);
  app.userAuth.verifyEmail(user.verify_token, {});
  if (role) app.userAuth.setRole(user.id, role);
  const login = app.userAuth.startLogin({ email, password: 'longenough1' });
  const session = app.userAuth.completeLogin({ pendingToken: login.pendingToken, code: login.mfaCode });
  return session.token;
}

test('POST /api/admin/personnel-registry/add requires super_admin specifically, not just admin', async () => {
  const app = appWith();
  const adminToken = await createSession(app, { email: 'admin-add@example.com', role: 'admin' });
  const superToken = await createSession(app, { email: 'super-add@example.com', role: 'super_admin' });

  const asAdmin = await call(app, {
    method: 'POST',
    url: '/api/admin/personnel-registry/add',
    headers: { authorization: `Bearer ${adminToken}` },
    body: { name: 'SI Karim', phone: '01799999999', email: 'karim@police.gov.bd' }
  });
  assert.equal(asAdmin.status, 401);

  const asSuperAdmin = await call(app, {
    method: 'POST',
    url: '/api/admin/personnel-registry/add',
    headers: { authorization: `Bearer ${superToken}` },
    body: { name: 'SI Karim', phone: '01799999999', email: 'karim@police.gov.bd' }
  });
  assert.equal(asSuperAdmin.status, 200);
  assert.equal(asSuperAdmin.json.record.name, 'SI Karim');
});

test('POST /api/admin/personnel-registry/add rejects a duplicate (phone, email) and invalid input, without a session', async () => {
  const app = appWith();
  const first = await call(app, {
    method: 'POST',
    url: '/api/admin/personnel-registry/add',
    headers: { 'x-api-key': 'topsecret' },
    body: { name: 'SI Karim', phone: '01799999999', email: 'karim@police.gov.bd' }
  });
  assert.equal(first.status, 200);

  const dup = await call(app, {
    method: 'POST',
    url: '/api/admin/personnel-registry/add',
    headers: { 'x-api-key': 'topsecret' },
    body: { name: 'Someone Else', phone: '01799999999', email: 'karim@police.gov.bd' }
  });
  assert.equal(dup.status, 400);
  assert.match(dup.json.error, /already exists/);

  const noAuth = await call(app, {
    method: 'POST',
    url: '/api/admin/personnel-registry/add',
    body: { name: 'X', phone: '01700000000', email: 'x@example.com' }
  });
  assert.equal(noAuth.status, 401);
});
