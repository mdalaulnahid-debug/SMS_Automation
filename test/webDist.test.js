'use strict';

// React app cutover (web/ Phase 6): src/app.js falls back to serving
// web/dist (a `vite build` output) for any GET request nothing else
// matched. Verifies the SPA-hosting contract -- matching file served
// directly, unknown path falls back to index.html, /api/* is never
// swallowed by the fallback, existing vanilla routes still win outright,
// and the whole thing is a no-op when webDistDir doesn't exist (today's
// real production state, until web/ is actually built and deployed).

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createApp } = require('../src/app');

function mockReq({ method = 'GET', url = '/', headers = {} } = {}) {
  const req = Readable.from(['']);
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
  return { status: res.statusCode, headers: res.headers, body: res.body.toString() };
}

function appWith(webDistDir) {
  return createApp({
    dbPath: '',
    authDbPath: ':memory:',
    authConfig: { adminApiKey: 'unused-legacy-key', requireGatewayAuth: false, denyUnknownRequesters: false, registrationWindowEndsAt: null },
    gatewayConfig: {},
    mailConfig: {},
    bootstrapSuperAdmin: false,
    webDistDir
  });
}

test('web/dist SPA serving', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'web-dist-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<html><body><div id="root">app shell</div></body></html>');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log("bundle");');

  t.after(() => rmSync(dir, { recursive: true, force: true }));

  await t.test('serves a matching file directly, long-cached', async () => {
    const app = appWith(dir);
    const res = await call(app, { url: '/assets/index-abc123.js' });
    assert.equal(res.status, 200);
    assert.match(res.body, /console\.log/);
    assert.equal(res.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.match(res.headers['cache-control'], /immutable/);
  });

  await t.test('falls back to index.html for an unknown client-side route', async () => {
    const app = appWith(dir);
    const res = await call(app, { url: '/settings/telegram' });
    assert.equal(res.status, 200);
    assert.match(res.body, /id="root"/);
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  await t.test('a path-traversal attempt cannot escape webDistDir -- falls back to index.html, never errors or leaks', async () => {
    const app = appWith(dir);
    const res = await call(app, { url: '/../../../../etc/passwd' });
    assert.equal(res.status, 200);
    assert.match(res.body, /id="root"/);
  });

  await t.test('/api/* unknown routes still 404 as JSON, never swallowed by the SPA fallback', async () => {
    const app = appWith(dir);
    const res = await call(app, { url: '/api/totally-made-up-endpoint' });
    assert.equal(res.status, 404);
    assert.equal(JSON.parse(res.body).error, 'Not found');
  });

  await t.test('an existing vanilla route (GET /) still wins outright over the SPA fallback', async () => {
    const app = appWith(dir);
    const res = await call(app, { url: '/' });
    // No session -> vanilla guardPage() redirects to /login.html; the SPA
    // fallback must never have gotten a chance to serve index.html here.
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /\/login\.html/);
  });
});

test('web/dist serving is a complete no-op when webDistDir does not exist (today\'s real production state)', async () => {
  const app = appWith(join(tmpdir(), 'definitely-does-not-exist-' + Date.now()));
  const res = await call(app, { url: '/settings/telegram' });
  assert.equal(res.status, 404);
  assert.equal(JSON.parse(res.body).error, 'Not found');
});
