'use strict';

// HTTP client for the SMS automation backend. The bridge talks to the same public API
// the dashboard uses — it holds no business logic of its own.

class BackendClient {
  constructor({ backendUrl, adminApiKey = '', fetchImpl = fetch }) {
    if (!backendUrl) throw new Error('backendUrl is required');
    this.base = backendUrl.replace(/\/+$/, '');
    this.adminApiKey = adminApiKey;
    this.fetch = fetchImpl;
  }

  headers(extra = {}) {
    // The bridge acts as an admin client (submits requests, polls + confirms approved replies).
    return {
      ...extra,
      ...(this.adminApiKey ? { 'x-api-key': this.adminApiKey } : {})
    };
  }

  async submitRequest(payload) {
    const res = await this.fetch(`${this.base}/api/requests`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    return res.json();
  }

  async listApprovedReplies() {
    const res = await this.fetch(`${this.base}/api/reply-drafts?status=APPROVED_FOR_POST`, {
      headers: this.headers()
    });
    const data = await res.json();
    return data.replyDrafts || [];
  }

  async listRecentRequests() {
    const res = await this.fetch(`${this.base}/api/dashboard`, {
      headers: this.headers()
    });
    const data = await res.json();
    return data.requests || [];
  }

  async markReplyPosted(replyId, postedMessageId) {
    const res = await this.fetch(
      `${this.base}/api/reply-drafts/${encodeURIComponent(replyId)}/posted`,
      {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ postedMessageId })
      }
    );
    return res.json();
  }

  async listPendingEdits() {
    const res = await this.fetch(`${this.base}/api/reply-drafts?status=APPROVED_FOR_EDIT`, {
      headers: this.headers()
    });
    const data = await res.json();
    return data.replyDrafts || [];
  }

  async markReplyEdited(replyId) {
    const res = await this.fetch(
      `${this.base}/api/reply-drafts/${encodeURIComponent(replyId)}/edited`,
      { method: 'POST', headers: this.headers({ 'content-type': 'application/json' }), body: '{}' }
    );
    return res.json();
  }

  // Reports a message received from a chat that doesn't match groupChatId — surfaces a config
  // drift (bridge listening to the wrong group) in admin/web audit instead of only a console
  // log line that's easy to miss until intake has been silently broken for hours.
  async reportChatMismatch({ chatId, chatTitle, configuredGroupChatId }) {
    try {
      await this.fetch(`${this.base}/api/telegram/chat-mismatch`, {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ chatId, chatTitle, configuredGroupChatId })
      });
    } catch {
      // Best-effort — never let a reporting failure affect the intake loop itself.
    }
  }

  // Reports a sender who failed the authorizedUsers check — group allowlist rejection, or
  // any private DM (always authorized-only). Previously only ever a console log line.
  async reportUnauthorizedAttempt({ chatId, chatType, fromId, fromName }) {
    try {
      await this.fetch(`${this.base}/api/telegram/unauthorized-attempt`, {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ chatId, chatType, fromId, fromName })
      });
    } catch {
      // Best-effort — never let a reporting failure affect the intake loop itself.
    }
  }

  // Mints a registration-link token for an unregistered private-DM sender, so the bot can
  // reply with a link to the web registration form. Best-effort like the reporting calls
  // above — if the backend is unreachable, the sender just gets no link this time and can
  // try again later; the intake loop must never break because of it.
  async requestRegistrationLink(telegramId) {
    try {
      const res = await this.fetch(`${this.base}/api/telegram/registration-link`, {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ telegramId })
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.url || null;
    } catch {
      return null;
    }
  }

  // Verifies a quota re-verification code (security-hardening v1 §7). Unlike the
  // best-effort reporting calls above, a network failure here must be visible to the
  // caller (not silently swallowed as "no active challenge") — the officer is actively
  // waiting to be unblocked, and a false "incorrect code" would be actively misleading.
  async verifyOtpCode(telegramId, code) {
    const res = await this.fetch(`${this.base}/api/telegram/verify-code`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ telegramId, code })
    });
    return res.json();
  }

  // Admin group actions (security-hardening v1 §9). Authorization is checked fresh on
  // every attempt (no caching/polling in the bridge) — a network failure must fail
  // closed (unauthorized), never silently let a moderation command through.
  async checkModerationAuthorized(telegramId) {
    try {
      const res = await this.fetch(`${this.base}/api/telegram/moderation-check`, {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ telegramId })
      });
      if (!res.ok) return { authorized: false };
      return res.json();
    } catch {
      return { authorized: false };
    }
  }

  // Reports a completed (or failed) moderation action for audit — best-effort, since
  // the actual Telegram-side action has already happened by the time this is called;
  // a reporting failure shouldn't be treated as the moderation action itself failing.
  async reportModerationAction(detail) {
    try {
      await this.fetch(`${this.base}/api/telegram/moderation-action`, {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(detail)
      });
    } catch {
      // Best-effort — never let a reporting failure affect the intake loop itself.
    }
  }
}

module.exports = { BackendClient };
