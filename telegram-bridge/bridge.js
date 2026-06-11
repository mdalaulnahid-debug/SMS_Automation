'use strict';

// Core, side-effect-light bridge logic. Kept separate from the long-poll runner
// (start.js) so it can be unit-tested without network or a live bot token.

// Compute a Telegram text_mention entity covering the leading "@Name" line of a draft,
// so the requester is tagged with a real, tappable mention. Telegram offsets/lengths are
// in UTF-16 code units, which matches JS string .length.
function buildMention(replyText, requesterId) {
  if (!requesterId) return null;
  const firstLine = String(replyText).split('\n', 1)[0];
  if (!firstLine.startsWith('@')) return null;
  return { offset: 0, length: firstLine.length, userId: requesterId };
}

// Decide what to do with an inbound group message. Returns a plan the caller executes,
// keeping this function free of network calls for easy testing.
function planIntake(message, config) {
  const text = (message.text || '').trim();
  const fromId = message.from && String(message.from.id);
  const chatId = message.chat && String(message.chat.id);

  if (!text) return { action: 'ignore', reason: 'no text' };
  if (chatId !== String(config.groupChatId)) {
    return { action: 'ignore', reason: 'wrong chat' };
  }

  const authorized = config.authorizedUsers && config.authorizedUsers[fromId];
  if (!authorized) {
    // Deny-by-default: never submit requests from unknown users.
    return {
      action: 'unauthorized',
      reason: 'sender not in authorizedUsers',
      fromId,
      replyText: config.replyToUnauthorized
        ? 'You are not authorized to submit requests in this group.'
        : null,
      replyToMessageId: message.message_id
    };
  }

  return {
    action: 'submit',
    request: {
      channel: 'telegram',
      chatId,
      sourceMessageId: message.message_id,
      requesterName: authorized.name || message.from.first_name || `user_${fromId}`,
      requesterWhatsappId: fromId,
      text
    },
    replyToMessageId: message.message_id
  };
}

// Process a single inbound message end-to-end (authorize → submit → ack/error reply).
async function handleIntake(message, { config, backend, telegram, log = () => {} }) {
  const plan = planIntake(message, config);

  if (plan.action === 'ignore') {
    return plan;
  }

  if (plan.action === 'unauthorized') {
    log(`intake: unauthorized user ${plan.fromId}`);
    if (plan.replyText) {
      await telegram.sendMessage({
        chatId: config.groupChatId,
        text: plan.replyText,
        replyToMessageId: plan.replyToMessageId
      });
    }
    return plan;
  }

  const result = await backend.submitRequest(plan.request);
  if (!result.ok) {
    // Parse/validation/authorization failure — surface the backend's correction message
    // back in-thread so the requester can fix and resend.
    const msg = result.replyText || (result.errors && result.errors.join('; ')) || 'Request rejected.';
    await telegram.sendMessage({
      chatId: config.groupChatId,
      text: msg,
      replyToMessageId: plan.replyToMessageId
    });
    log(`intake: rejected — ${msg}`);
    return { action: 'rejected', result };
  }

  log(`intake: accepted ${result.request.requestId} (${plan.request.text})`);
  if (config.ackOnIntake) {
    await telegram.sendMessage({
      chatId: config.groupChatId,
      text: `Received — request ${result.request.requestId} is being processed.`,
      replyToMessageId: plan.replyToMessageId
    });
  }
  return { action: 'submitted', result };
}

// Poll the backend for reviewer-approved drafts and post each one to the group,
// threaded to the original request and tagging the requester. Confirms back to the
// backend only after a successful post, so an unsent reply is retried next cycle.
async function postApprovedReplies({ backend, telegram, log = () => {} }) {
  const replies = await backend.listApprovedReplies();
  const posted = [];
  for (const reply of replies) {
    if (reply.channel !== 'telegram') continue;
    try {
      const sent = await telegram.sendThreadedReply({
        chatId: reply.chatId,
        text: reply.replyText,
        replyToMessageId: reply.sourceMessageId,
        mention: buildMention(reply.replyText, reply.requesterId)
      });
      await backend.markReplyPosted(reply.id, sent.message_id);
      posted.push(reply.id);
      log(`post: delivered reply ${reply.id} for ${reply.requestId} as msg ${sent.message_id}`);
    } catch (error) {
      log(`post: FAILED reply ${reply.id} — ${error.message} (will retry)`);
    }
  }
  return posted;
}

module.exports = { buildMention, planIntake, handleIntake, postApprovedReplies };
