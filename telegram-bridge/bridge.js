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

function shouldSuppressGroupReply(result) {
  const suppressed = new Set([
    'REQUEST_DENIED_DISABLED_USER',
    'REQUEST_DENIED_UNKNOWN_USER',
    'REQUEST_DENIED_UNAUTHORIZED_OPERATOR'
  ]);
  return suppressed.has(result?.errorCode);
}

// Decide what to do with an inbound message — from the configured group, or a private DM.
// Returns a plan the caller executes, keeping this function free of network calls for
// easy testing.
function planIntake(message, config) {
  const text = (message.text || '').trim();
  const fromId = message.from && String(message.from.id);
  const chatId = message.chat && String(message.chat.id);
  const isGroupChat = chatId === String(config.groupChatId);
  const isPrivateChat = message.chat && message.chat.type === 'private';

  if (!text) return { action: 'ignore', reason: 'no text' };
  if (!isGroupChat && !isPrivateChat) {
    return { action: 'ignore', reason: 'wrong chat', chatId, chatTitle: message.chat?.title || null };
  }

  const authorizedUsers = config.authorizedUsers || {};
  const authorized = authorizedUsers[fromId];
  const firstName = message.from.first_name || '';
  const lastName = message.from.last_name || '';
  const fromName = authorized?.name
    || [firstName, lastName].filter(Boolean).join(' ')
    || `user_${fromId}`;

  if (isPrivateChat) {
    // A private DM with the bot has no equivalent of "group membership" as a gate, so it's
    // always authorized-only — silently ignored if the sender isn't on the allowlist, same
    // policy as every other authorization failure (see shouldSuppressGroupReply). Reported
    // once per (chat, sender) so an unauthorized DM is still visible in admin/web audit
    // instead of disappearing with only a console log line.
    if (!authorized) {
      return { action: 'unauthorized', reason: 'unauthorized private sender', fromId, chatId, chatType: 'private', fromName, replyText: null };
    }
  } else {
    // Group chat: open by default unless an allowlist is configured.
    const hasAllowList = Object.keys(authorizedUsers).length > 0;
    if (hasAllowList && !authorized) {
      return {
        action: 'unauthorized',
        reason: 'sender not in authorizedUsers',
        fromId,
        chatId,
        chatType: 'group',
        fromName,
        replyText: config.replyToUnauthorized
          ? 'You are not authorized to submit requests in this group.'
          : null,
        replyToMessageId: message.message_id
      };
    }
  }

  return {
    action: 'submit',
    request: {
      channel: 'telegram',
      chatId,
      sourceMessageId: message.message_id,
      requesterName: fromName,
      requesterId: fromId,
      text,
      ...(config.testDestination ? { testDestination: config.testDestination } : {})
    },
    replyToMessageId: message.message_id
  };
}

// Process a single inbound message end-to-end (authorize → submit → ack/error reply).
async function handleIntake(message, {
  config,
  backend,
  telegram,
  log = () => {},
  reportedMismatchChatIds = new Set(),
  reportedUnauthorizedSenders = new Set()
}) {
  const plan = planIntake(message, config);

  if (plan.action === 'ignore') {
    // A config drift between groupChatId and the actual group silently breaks intake with
    // nothing but a console log line — report it once per distinct wrong chat so it shows up
    // in admin/web audit instead of going unnoticed for hours (see TELEGRAM_CHAT_MISMATCH).
    if (plan.reason === 'wrong chat' && !reportedMismatchChatIds.has(plan.chatId)) {
      reportedMismatchChatIds.add(plan.chatId);
      await backend.reportChatMismatch({
        chatId: plan.chatId,
        chatTitle: plan.chatTitle,
        configuredGroupChatId: String(config.groupChatId)
      });
    }
    return plan;
  }

  if (plan.action === 'unauthorized') {
    log(`intake: unauthorized ${plan.chatType} sender ${plan.fromId}`);
    const dedupeKey = `${plan.chatId}:${plan.fromId}`;
    if (!reportedUnauthorizedSenders.has(dedupeKey)) {
      reportedUnauthorizedSenders.add(dedupeKey);
      await backend.reportUnauthorizedAttempt({
        chatId: plan.chatId,
        chatType: plan.chatType,
        fromId: plan.fromId,
        fromName: plan.fromName
      });
    }
    // Never reply — every authorization failure (group allowlist or private DM) stays
    // silent in chat by design; visibility comes from the admin/web audit report above,
    // not a message back to the sender. plan.replyText is computed but intentionally
    // unused here (see shouldSuppressGroupReply for the equivalent post-submit policy).
    return plan;
  }

  const result = await backend.submitRequest(plan.request);
  if (!result.ok) {
    // Parse/validation/authorization failure — surface the backend's correction message
    // back in-thread (in whichever chat the request came from) so the requester can fix
    // and resend.
    const msg = result.replyText || (result.errors && result.errors.join('; ')) || 'Request rejected.';
    if (!shouldSuppressGroupReply(result)) {
      await telegram.sendMessage({
        chatId: plan.request.chatId,
        text: msg,
        replyToMessageId: plan.replyToMessageId
      });
    }
    log(`intake: rejected — ${msg}`);
    return { action: 'rejected', result };
  }

  log(`intake: accepted ${result.request.requestId} (${plan.request.text})`);
  if (config.ackOnIntake) {
    const operators = (result.request.targetOperators || []).join(', ') || 'operator';
    await telegram.sendMessage({
      chatId: plan.request.chatId,
      text: `✅ Request received — sending to ${operators}. Reply will be posted here when received.`,
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
    // Grace period: hold multi-op live drafts for a few seconds so replies that arrive
    // close together are batched into a single post rather than rapid partial posts.
    if (reply.holdUntil && Date.now() < reply.holdUntil) {
      log(`post: holding reply ${reply.id} for ${Math.ceil((reply.holdUntil - Date.now()) / 1000)}s (grace period)`);
      continue;
    }
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

// Edit live Telegram messages as more operators reply to a fan-out request (NID-MS, IMEI-MS).
// The backend marks each updated draft APPROVED_FOR_EDIT with the latest combined text.
// After editing, confirm back to the backend so it can finalise the request if all operators
// are done, or keep the message live if some are still pending.
async function postLiveEdits({ backend, telegram, log = () => {} }) {
  const replies = await backend.listPendingEdits();
  const edited = [];
  for (const reply of replies) {
    if (reply.channel !== 'telegram') continue;
    if (!reply.postedMessageId) continue; // initial post not yet confirmed — skip until it is
    try {
      const mention = buildMention(reply.replyText, reply.requesterId);
      await telegram.editMessage({
        chatId: reply.chatId,
        messageId: reply.postedMessageId,
        text: reply.replyText,
        replyToMessageId: reply.sourceMessageId,
        mention
      });
      await backend.markReplyEdited(reply.id);
      edited.push(reply.id);
      log(`live-edit: updated reply ${reply.id} for ${reply.requestId} (msg ${reply.postedMessageId})`);
    } catch (error) {
      log(`live-edit: FAILED reply ${reply.id} — ${error.message} (will retry)`);
    }
  }
  return edited;
}

// Notify the group when requests time out or fail without any reply.
// Tracks which request IDs have been notified to avoid repeats.
async function notifyTimeouts({ backend, telegram, notifiedSet, log = () => {} }) {
  const requests = await backend.listRecentRequests();
  const posted = [];
  for (const request of requests) {
    if (request.channel !== 'telegram') continue;
    if (!['TIMEOUT', 'FAILED'].includes(request.status)) continue;
    if (notifiedSet.has(request.requestId)) continue;

    const statusLabel = request.status === 'TIMEOUT' ? 'timed out (no reply received)' : 'failed';
    const text = [
      `@${request.requesterName}`,
      `Request ${request.requestId} (${request.requestType} ${request.payload}) ${statusLabel}.`,
      request.failedReason || '',
      'Contact the administrator if this request should be retried.'
    ].filter(Boolean).join('\n');

    try {
      const mention = buildMention(text, request.requesterId);
      await telegram.sendThreadedReply({
        chatId: request.chatId,
        text,
        replyToMessageId: request.sourceMessageId,
        mention
      });
      notifiedSet.add(request.requestId);
      posted.push(request.requestId);
      log(`timeout-notify: ${request.requestId} (${request.status})`);
    } catch (error) {
      log(`timeout-notify: FAILED ${request.requestId} — ${error.message}`);
    }
  }
  return posted;
}

module.exports = { buildMention, planIntake, handleIntake, postApprovedReplies, postLiveEdits, notifyTimeouts, shouldSuppressGroupReply };
