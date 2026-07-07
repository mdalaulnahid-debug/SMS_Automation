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
