'use strict';

// Thin wrapper over the official Telegram Bot API using long polling.
// Zero dependencies — relies on Node 18+ global fetch.

class TelegramClient {
  constructor({ botToken, fetchImpl = fetch }) {
    if (!botToken) throw new Error('botToken is required');
    this.base = `https://api.telegram.org/bot${botToken}`;
    this.fetch = fetchImpl;
  }

  async call(method, params = {}) {
    const res = await this.fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params)
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(`Telegram ${method} failed: ${data.error_code} ${data.description}`);
    }
    return data.result;
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
    return this.call('sendMessage', params);
  }

  sendMessage({ chatId, text, replyToMessageId }) {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      reply_to_message_id: replyToMessageId,
      allow_sending_without_reply: true
    });
  }

  // Edit an existing Telegram message in-place (live posting updates).
  // Falls back to sendThreadedReply if the message is too old to edit (>48h).
  async editMessage({ chatId, messageId, text, replyToMessageId, mention }) {
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
      // Message too old to edit or already identical — fall back to a new reply
      if (err.message && (err.message.includes("can't be edited") || err.message.includes('message is not modified'))) {
        if (err.message.includes('message is not modified')) return null;
        return this.sendThreadedReply({ chatId, text, replyToMessageId, mention });
      }
      throw err;
    }
  }
}

module.exports = { TelegramClient };
