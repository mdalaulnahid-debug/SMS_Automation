'use strict';

// Thin wrapper over the official Telegram Bot API using long polling.
// Zero dependencies — relies on Node 18+ global fetch.

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TelegramClient {
  constructor({ botToken, fetchImpl = fetch, minSendSpacingMs = 1100, sleepImpl = defaultSleep }) {
    if (!botToken) throw new Error('botToken is required');
    this.base = `https://api.telegram.org/bot${botToken}`;
    this.fetch = fetchImpl;
    this.minSendSpacingMs = minSendSpacingMs;
    this.sleep = sleepImpl;
    this.lastSendAt = 0;
    // Serializes outgoing message sends (not getUpdates) so a burst — e.g. many timeouts
    // discovered at once after a restart — can't fire faster than Telegram's per-chat rate
    // limit. A Promise chain rather than a mutex dependency, keeping this bridge dependency-free.
    this._sendQueue = Promise.resolve();
  }

  async call(method, params = {}) {
    const res = await this.fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params)
    });
    const data = await res.json();
    if (!data.ok) {
      const err = new Error(`Telegram ${method} failed: ${data.error_code} ${data.description}`);
      err.errorCode = data.error_code;
      if (data.error_code === 429 && data.parameters && data.parameters.retry_after) {
        err.retryAfterMs = data.parameters.retry_after * 1000;
      }
      throw err;
    }
    return data.result;
  }

  // Spaces out and serializes outgoing sends (sendMessage/sendThreadedReply/editMessageText) —
  // group posts and private DMs alike — so a backlog can't flood a chat past Telegram's
  // per-chat rate limit. getUpdates (long-poll, up to 30s) is intentionally NOT routed through
  // this queue so a pending poll can never block an outgoing send behind it.
  _throttledSend(fn) {
    const run = async () => {
      const wait = this.minSendSpacingMs - (Date.now() - this.lastSendAt);
      if (wait > 0) await this.sleep(wait);
      try {
        return await fn();
      } catch (error) {
        if (error.retryAfterMs) {
          // Telegram told us exactly how long to back off — honor it before the next
          // queued send gets its turn, instead of retrying straight into the same limit.
          await this.sleep(Math.min(error.retryAfterMs, 60_000));
        }
        throw error;
      } finally {
        this.lastSendAt = Date.now();
      }
    };
    // Chain onto the queue regardless of whether the previous send succeeded or failed, so
    // one failure doesn't wedge every later send; swallow the tracking link's own rejection
    // (the real error still propagates to whoever awaits this call's own return value).
    const result = this._sendQueue.then(run, run);
    this._sendQueue = result.catch(() => {});
    return result;
  }

  // Long poll for new updates. timeoutSec keeps the HTTP request open server-side
  // until a message arrives or the timeout elapses, so this is not a busy loop.
  getUpdates({ offset, timeoutSec = 30 }) {
    return this.call('getUpdates', {
      offset,
      timeout: timeoutSec,
      allowed_updates: ['message']
    });
  }

  // Post a reply threaded to the original request message, with a real tappable mention
  // of the requester via a text_mention entity (works even without a public @username).
  sendThreadedReply({ chatId, text, replyToMessageId, mention }) {
    const params = {
      chat_id: chatId,
      text,
      reply_to_message_id: replyToMessageId,
      allow_sending_without_reply: true
    };
    if (mention && mention.userId && mention.length > 0) {
      params.entities = [
        {
          type: 'text_mention',
          offset: mention.offset || 0,
          length: mention.length,
          user: { id: Number(mention.userId) }
        }
      ];
    }
    return this._throttledSend(() => this.call('sendMessage', params));
  }

  sendMessage({ chatId, text, replyToMessageId }) {
    return this._throttledSend(() => this.call('sendMessage', {
      chat_id: chatId,
      text,
      reply_to_message_id: replyToMessageId,
      allow_sending_without_reply: true
    }));
  }

  // Edit an existing Telegram message in-place (live posting updates).
  // Falls back to sendThreadedReply if the message is too old to edit (>48h).
  editMessage({ chatId, messageId, text, replyToMessageId, mention }) {
    return this._throttledSend(async () => {
      const params = { chat_id: chatId, message_id: messageId, text };
      if (mention && mention.userId && mention.length > 0) {
        params.entities = [
          {
            type: 'text_mention',
            offset: mention.offset || 0,
            length: mention.length,
            user: { id: Number(mention.userId) }
          }
        ];
      }
      try {
        return await this.call('editMessageText', params);
      } catch (err) {
        // Message too old to edit or already identical — fall back to a new reply. Calls
        // this.call() directly (not this.sendThreadedReply()) since we're already inside
        // the throttle wrapper and don't want to double-queue/double-space this send.
        if (err.message && (err.message.includes("can't be edited") || err.message.includes('message is not modified'))) {
          if (err.message.includes('message is not modified')) return null;
          const fallbackParams = {
            chat_id: chatId,
            text,
            reply_to_message_id: replyToMessageId,
            allow_sending_without_reply: true
          };
          if (mention && mention.userId && mention.length > 0) fallbackParams.entities = params.entities;
          return this.call('sendMessage', fallbackParams);
        }
        throw err;
      }
    });
  }
}

module.exports = { TelegramClient };
