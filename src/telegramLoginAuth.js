'use strict';

// Officer Portal access, replacing the old userAuth-based officer login (which
// startLogin() now blocks entirely -- officers interact with the system only
// through Telegram). Identity comes from the Telegram Login Widget: the widget
// itself is what "imports the name/username from Telegram", and authorization
// is simply membership in the existing authorizedUsers DM allowlist
// (settingsStore.readAuthorizedUsers()) that already gates private-DM access
// to the bot. No separate officer registration/account exists for this path.

const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');

// Telegram's documented widget-verification window is left to the integrator;
// 24h is generous for a same-session login flow while still bounding replay
// of a captured payload.
const AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

// Verifies a Telegram Login Widget payload per Telegram's documented algorithm:
// https://core.telegram.org/widgets/login#checking-authorization
// secret_key = SHA256(bot_token); expected_hash = HMAC_SHA256(data_check_string, secret_key).
function verifyTelegramAuthPayload(data, botToken) {
  if (!data || typeof data !== 'object') return false;
  if (!botToken) return false;
  const { hash, ...rest } = data;
  if (!hash || typeof hash !== 'string') return false;

  const dataCheckString = Object.keys(rest)
    .filter((key) => rest[key] !== undefined && rest[key] !== null && rest[key] !== '')
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('\n');

  const secretKey = createHash('sha256').update(botToken).digest();
  const expectedHex = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  let expected;
  let actual;
  try {
    expected = Buffer.from(expectedHex, 'hex');
    actual = Buffer.from(String(hash), 'hex');
  } catch {
    return false;
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

  const authDate = Number(data.auth_date);
  if (!Number.isFinite(authDate)) return false;
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds < 0 || ageSeconds > AUTH_MAX_AGE_SECONDS) return false;

  return true;
}

// In-memory only, deliberately -- this is a lightweight "no registration"
// stopgap (2026-08-04), not a durable account system. A server restart signs
// everyone out, which is an acceptable trade for now.
class PortalSessionStore {
  constructor({ ttlMs = 8 * 60 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.sessions = new Map();
  }

  create(user) {
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, { ...user, expiresAt: Date.now() + this.ttlMs });
    return token;
  }

  get(token) {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  delete(token) {
    this.sessions.delete(token);
  }
}

module.exports = { verifyTelegramAuthPayload, PortalSessionStore, AUTH_MAX_AGE_SECONDS };
