'use strict';

// Minimal, dependency-free cookie helpers. This app's session transport is
// otherwise entirely header-based (Authorization/x-api-key, read from
// localStorage on the client) for API calls — but a plain browser page
// navigation never carries localStorage data or custom headers, only
// cookies. This module exists specifically so the server can recognize a
// logged-in session on the initial HTML request, which is what makes real
// server-side page gating possible (see docs/security-hardening-v1-design.md §4;
// API-level auth via requireAdmin/requireAnySession in app.js is unaffected).

const SESSION_COOKIE_NAME = 'sessionToken';

function parseCookies(cookieHeader) {
  const result = {};
  if (!cookieHeader) return result;
  for (const part of String(cookieHeader).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

// `secure` should be passed true whenever the connection is actually HTTPS —
// the caller determines that (e.g. checking x-forwarded-proto behind a
// TLS-terminating reverse proxy in production; the VPS terminates TLS at
// nginx, so Node itself sees plain HTTP even in production).
function serializeSessionCookie(token, { maxAgeSeconds, secure = false } = {}) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie({ secure = false } = {}) {
  return serializeSessionCookie('', { maxAgeSeconds: 0, secure });
}

function sessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || '';
}

module.exports = {
  SESSION_COOKIE_NAME,
  parseCookies,
  serializeSessionCookie,
  clearSessionCookie,
  sessionTokenFromRequest
};
