'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseCookies,
  serializeSessionCookie,
  clearSessionCookie,
  sessionTokenFromRequest
} = require('../src/cookies');

test('parseCookies parses multiple cookies from a single header', () => {
  const parsed = parseCookies('sessionToken=abc123; theme=dark; other=1');
  assert.equal(parsed.sessionToken, 'abc123');
  assert.equal(parsed.theme, 'dark');
  assert.equal(parsed.other, '1');
});

test('parseCookies decodes URI-encoded values', () => {
  const parsed = parseCookies('sessionToken=abc%2F123');
  assert.equal(parsed.sessionToken, 'abc/123');
});

test('parseCookies handles a missing or empty header without throwing', () => {
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(null), {});
});

test('parseCookies ignores malformed segments (no "=")', () => {
  const parsed = parseCookies('sessionToken=abc123; malformed; theme=dark');
  assert.equal(parsed.sessionToken, 'abc123');
  assert.equal(parsed.theme, 'dark');
  assert.equal(parsed.malformed, undefined);
});

test('serializeSessionCookie includes HttpOnly, SameSite=Lax, Path=/, and Max-Age', () => {
  const cookie = serializeSessionCookie('mytoken', { maxAgeSeconds: 28800 });
  assert.match(cookie, /^sessionToken=mytoken;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=28800/);
  assert.doesNotMatch(cookie, /Secure/, 'Secure must be opt-in, not default');
});

test('serializeSessionCookie adds Secure only when explicitly requested', () => {
  const cookie = serializeSessionCookie('mytoken', { maxAgeSeconds: 100, secure: true });
  assert.match(cookie, /Secure/);
});

test('serializeSessionCookie URL-encodes the token', () => {
  const cookie = serializeSessionCookie('has/slash+plus', { maxAgeSeconds: 100 });
  assert.match(cookie, /sessionToken=has%2Fslash%2Bplus/);
});

test('clearSessionCookie sets Max-Age=0', () => {
  assert.match(clearSessionCookie(), /Max-Age=0/);
});

test('sessionTokenFromRequest reads the session cookie off a request-like object', () => {
  const req = { headers: { cookie: 'sessionToken=xyz789; other=1' } };
  assert.equal(sessionTokenFromRequest(req), 'xyz789');
});

test('sessionTokenFromRequest returns empty string when no cookie header is present', () => {
  assert.equal(sessionTokenFromRequest({ headers: {} }), '');
  assert.equal(sessionTokenFromRequest({}), '');
});
