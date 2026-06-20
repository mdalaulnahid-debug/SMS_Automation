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
}

module.exports = { BackendClient };
