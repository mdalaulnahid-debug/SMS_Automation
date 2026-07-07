'use strict';

// One-time re-verification codes sent to an officer's registry-verified
// contact channel (email in V1) after a quota breach. Telegram exposes no
// IP/device signal, so this out-of-band code — reaching a channel the
// impersonator does not control — is the actual impersonation defense.
// See docs/security-hardening-v1-design.md §7.

const { randomInt } = require('node:crypto');

const DEFAULT_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_MAX_ISSUANCE_PER_HOUR = 3;
const ISSUANCE_WINDOW_MS = 60 * 60 * 1000;

function generateCode() {
  // 6-digit numeric, zero-padded. randomInt is cryptographically secure
  // (unlike Math.random), appropriate for an auth code.
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

class OtpStore {
  constructor({
    codeTtlMs = DEFAULT_CODE_TTL_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    maxIssuancePerHour = DEFAULT_MAX_ISSUANCE_PER_HOUR,
    now = () => Date.now()
  } = {}) {
    this.codeTtlMs = codeTtlMs;
    this.maxAttempts = maxAttempts;
    this.maxIssuancePerHour = maxIssuancePerHour;
    this.now = now;
    this.challenges = new Map(); // officerId -> { code, expiresAt, attempts }
    this.issuanceLog = new Map(); // officerId -> [issuedAt timestamps]
  }

  _pruneIssuanceLog(officerId) {
    const nowTs = this.now();
    const pruned = (this.issuanceLog.get(officerId) || []).filter(
      (ts) => nowTs - ts < ISSUANCE_WINDOW_MS
    );
    this.issuanceLog.set(officerId, pruned);
    return pruned;
  }

  // Generates and stores a new code unless the officer has hit the
  // per-hour issuance cap (stops the challenge itself being used to spam
  // an officer's inbox). Returns the plaintext code for the caller to
  // send; { code: null, throttled: true } if capped.
  issueCode(officerId) {
    const log = this._pruneIssuanceLog(officerId);
    if (log.length >= this.maxIssuancePerHour) {
      return { code: null, throttled: true };
    }
    const code = generateCode();
    this.challenges.set(officerId, {
      code,
      expiresAt: this.now() + this.codeTtlMs,
      attempts: 0
    });
    log.push(this.now());
    this.issuanceLog.set(officerId, log);
    return { code, throttled: false };
  }

  // Verifies a submitted code. The challenge is consumed (removed) on
  // success, on expiry, or once attempts are exhausted — a spent challenge
  // can never be retried without a fresh issueCode() call.
  verifyCode(officerId, submitted) {
    const challenge = this.challenges.get(officerId);
    if (!challenge) return { ok: false, reason: 'NO_ACTIVE_CHALLENGE' };

    if (this.now() > challenge.expiresAt) {
      this.challenges.delete(officerId);
      return { ok: false, reason: 'EXPIRED' };
    }

    challenge.attempts += 1;
    if (String(submitted ?? '').trim() !== challenge.code) {
      if (challenge.attempts >= this.maxAttempts) {
        this.challenges.delete(officerId);
        return { ok: false, reason: 'ATTEMPTS_EXCEEDED' };
      }
      return { ok: false, reason: 'INCORRECT' };
    }

    this.challenges.delete(officerId);
    return { ok: true };
  }
}

module.exports = { OtpStore, generateCode };
