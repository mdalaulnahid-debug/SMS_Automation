'use strict';

// Per-officer request quota: count AND time window, whichever trips first.
// On breach, the caller (middleware, not built yet) must challenge the
// officer via OTP before further requests proceed. See
// docs/security-hardening-v1-design.md §7.

const DEFAULT_MAX_REQUESTS = 20;
const DEFAULT_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours

class QuotaTracker {
  constructor({
    maxRequests = DEFAULT_MAX_REQUESTS,
    windowMs = DEFAULT_WINDOW_MS,
    now = () => Date.now()
  } = {}) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.now = now;
    this.sessions = new Map(); // officerId -> { count, windowStartedAt }
  }

  _getOrCreateSession(officerId, windowMs) {
    const nowTs = this.now();
    let session = this.sessions.get(officerId);
    if (!session) {
      session = { count: 0, windowStartedAt: nowTs };
      this.sessions.set(officerId, session);
      return session;
    }
    if (nowTs - session.windowStartedAt >= windowMs) {
      // Window naturally elapsed — a fresh window, not a quota violation.
      session.count = 0;
      session.windowStartedAt = nowTs;
    }
    return session;
  }

  // Records one request attempt and reports whether it's allowed. Once the
  // window's max is reached, every further call in that window is blocked
  // (requiresVerification: true) until resetAfterVerification() is called.
  recordRequest(officerId, overrides = {}) {
    const maxRequests = overrides.maxRequests ?? this.maxRequests;
    const windowMs = overrides.windowMs ?? this.windowMs;
    const session = this._getOrCreateSession(officerId, windowMs);

    if (session.count >= maxRequests) {
      return { allowed: false, requiresVerification: true, remaining: 0 };
    }

    session.count += 1;
    return { allowed: true, requiresVerification: false, remaining: maxRequests - session.count };
  }

  // Called after a successful OTP re-verification — reopens a fresh window.
  resetAfterVerification(officerId) {
    this.sessions.set(officerId, { count: 0, windowStartedAt: this.now() });
  }

  getSession(officerId) {
    return this.sessions.get(officerId) || null;
  }
}

module.exports = { QuotaTracker, DEFAULT_MAX_REQUESTS, DEFAULT_WINDOW_MS };
