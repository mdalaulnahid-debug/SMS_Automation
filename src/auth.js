'use strict';

// Request authentication for the backend API. Two credentials exist:
//  - admin API key: protects the human-facing dashboard/admin API (single key is enough at this scale)
//  - per-gateway shared secret: machine identity for phone→backend webhook + registration
//
// Backwards-compatible by default: if adminApiKey is empty, admin auth is disabled (dev/test);
// a gateway with no secret is accepted unless requireGatewayAuth is on. Production sets both.

const { timingSafeEqual } = require('node:crypto');

// Extract a presented token from Authorization: Bearer <t> or the x-api-key header.
function presentedToken(req) {
  const headers = req.headers || {};
  const authHeader = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(authHeader).trim());
  if (match) return match[1].trim();
  const apiKey = headers['x-api-key'] || headers['X-Api-Key'];
  return apiKey ? String(apiKey).trim() : '';
}

function presentedGatewaySecret(req) {
  const headers = req.headers || {};
  const secret = headers['x-gateway-secret'] || headers['X-Gateway-Secret'];
  if (secret) return String(secret).trim();
  // Fall back to the bearer token so a phone can use a single Authorization header.
  return presentedToken(req);
}

// Constant-time string compare that tolerates differing lengths without leaking via early return.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isAdmin(req, authConfig) {
  if (!authConfig || !authConfig.adminApiKey) return true; // auth disabled (dev/test)
  return safeEqual(presentedToken(req), authConfig.adminApiKey);
}

// Validate a gateway's shared secret. If the gateway has a configured secret, the request must
// present it. If it has none: allowed unless requireGatewayAuth (strict mode) is set.
function isValidGateway(req, gatewayId, store, authConfig) {
  let gateway = null;
  try {
    gateway = gatewayId ? store.getGateway(gatewayId) : null;
  } catch {
    gateway = null;
  }
  if (!gateway) return false; // unknown/missing gateway is never a valid machine identity
  if (gateway.secret) return safeEqual(presentedGatewaySecret(req), gateway.secret);
  return !(authConfig && authConfig.requireGatewayAuth);
}

module.exports = { presentedToken, presentedGatewaySecret, isAdmin, isValidGateway };
