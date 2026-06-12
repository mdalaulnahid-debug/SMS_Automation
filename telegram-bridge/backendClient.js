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
    const res = await this.fetch(`${this.base}/api/whatsapp-replies?status=APPROVED_FOR_POST`, {
      headers: this.headers()
    });
    const data = await res.json();
    return data.whatsappReplies || [];
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
      `${this.base}/api/whatsapp-replies/${encodeURIComponent(replyId)}/posted`,
      {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ postedMessageId })
      }
    );
    return res.json();
  }
}

module.exports = { BackendClient };
