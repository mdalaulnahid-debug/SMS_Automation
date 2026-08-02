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
    'REQUEST_DENIED_UNAUTHORIZED_OPERATOR',
    // Admin-post bypass (design doc §9) — an admin's non-command group
    // message is a deliberate announcement, not a mistake to flag back to
    // them; see checkOfficerQuota's counterpart in src/app.js.
    'ADMIN_POST_BYPASS'
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
  }
  // Group chat: always open — any group member can submit. The authorizedUsers
  // list only gates private-DM access; it never restricts the group.

  // A bare 6-digit private DM from an authorized sender is treated as a
  // quota re-verification code reply (design doc §7), not a malformed
  // request — no real request command is ever shaped like a standalone
  // 6-digit number, so this is unambiguous. Group messages are never
  // treated this way; the officer replies where the challenge email told
  // them to, which is always the private chat with the bot.
  if (isPrivateChat && /^\d{6}$/.test(text)) {
    return { action: 'otp_verify', telegramId: fromId, chatId, code: text, replyToMessageId: message.message_id };
  }

  // Moderation commands (design doc §9) — group chat only. Detection here is
  // shape-only; authorization is checked fresh against the backend in
  // handleIntake, never against this bridge's static config, so a role
  // change takes effect on the very next command. /ban, /mute, /unmute
  // target whoever the command replies to (the standard Telegram-mod-bot
  // UX — usernames aren't reliably resolvable to user IDs via the Bot API
  // without them already being cached). /unban takes an explicit numeric
  // ID since a banned user can't be replied to.
  if (isGroupChat) {
    const isBan = /^\/ban$/i.test(text);
    const isUnmute = /^\/unmute$/i.test(text);
    const muteMatch = text.match(/^\/mute(?:\s+(\d+))?$/i);
    const unbanMatch = text.match(/^\/unban\s+(\d+)$/i);

    if (isBan || isUnmute || muteMatch) {
      const target = message.reply_to_message;
      if (!target || !target.from) {
        return {
          action: 'moderate_usage_error',
          chatId,
          replyToMessageId: message.message_id,
          replyText: "Reply to the member's message with this command to target them."
        };
      }
      const targetId = String(target.from.id);
      const targetName = [target.from.first_name, target.from.last_name].filter(Boolean).join(' ') || `user_${targetId}`;
      return {
        action: 'moderate',
        moderationAction: isBan ? 'ban' : isUnmute ? 'unmute' : 'mute',
        actorId: fromId,
        actorName: fromName,
        targetId,
        targetName,
        durationMinutes: muteMatch && muteMatch[1] ? Number(muteMatch[1]) : null,
        chatId,
        replyToMessageId: message.message_id
      };
    }

    if (unbanMatch) {
      return {
        action: 'moderate',
        moderationAction: 'unban',
        actorId: fromId,
        actorName: fromName,
        targetId: unbanMatch[1],
        targetName: null,
        durationMinutes: null,
        chatId,
        replyToMessageId: message.message_id
      };
    }
  }

  // For forwarded messages, message.from is the group member who forwarded —
  // that's who the reply should tag. The original author (forward_from /
  // forward_sender_name) is stored separately for audit traceability only.
  const forwardedFrom = message.forward_from
    ? [message.forward_from.first_name, message.forward_from.last_name].filter(Boolean).join(' ')
    : (message.forward_sender_name || null);

  return {
    action: 'submit',
    request: {
      channel: 'telegram',
      chatId,
      sourceMessageId: message.message_id,
      requesterName: fromName,
      requesterId: fromId,
      text,
      // Metadata for the behavioral anomaly tripwire (design doc §11) — not
      // used for authorization, only fed to the backend's identity-drift
      // check. Telegram omits language_code/username when unset, hence the
      // null fallback rather than assuming they're always present.
      languageCode: message.from.language_code || null,
      username: message.from.username || null,
      ...(forwardedFrom ? { forwardedFrom } : {}),
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
  reportedUnauthorizedSenders = new Set(),
  reportedRegistrationNudges = new Set()
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
      // A first-time unregistered private DM gets a registration link, per
      // the design doc's "whenever a new user requests, the bot provides a
      // link" flow — group-chat unauthorized senders (not a concept today,
      // since the group is still open) stay silent, as does a repeat DM from
      // this sender in the same run (reuses the audit-report dedupe so the
      // link isn't re-sent on every retry message).
      if (plan.chatType === 'private' && backend.requestRegistrationLink) {
        const url = await backend.requestRegistrationLink(plan.fromId);
        if (url) {
          await telegram.sendMessage({
            chatId: plan.chatId,
            text: `You're not registered yet. Complete registration here to get access:\n${url}`
          });
        }
      }
    }
    return plan;
  }

  if (plan.action === 'otp_verify') {
    const result = await backend.verifyOtpCode(plan.telegramId, plan.code);
    const replyText = result.ok
      ? '✅ Verified — you can continue submitting requests.'
      : {
          NO_ACTIVE_CHALLENGE: "You don't have an active verification code right now.",
          EXPIRED: 'That code expired. Send a new request to get a fresh one.',
          INCORRECT: 'Incorrect code. Try again.',
          ATTEMPTS_EXCEEDED: 'Too many incorrect attempts — that code is no longer valid. Send a new request to get a fresh one.'
        }[result.reason] || 'Verification failed. Try again or contact an administrator.';
    await telegram.sendMessage({ chatId: plan.chatId, text: replyText, replyToMessageId: plan.replyToMessageId });
    log(`otp: ${plan.telegramId} — ${result.ok ? 'verified' : `failed (${result.reason})`}`);
    return { action: 'otp_verify_result', result };
  }

  if (plan.action === 'moderate_usage_error') {
    await telegram.sendMessage({ chatId: plan.chatId, text: plan.replyText, replyToMessageId: plan.replyToMessageId });
    return plan;
  }

  if (plan.action === 'moderate') {
    const auth = await backend.checkModerationAuthorized(plan.actorId);
    if (!auth.authorized) {
      await telegram.sendMessage({
        chatId: plan.chatId,
        text: 'You are not authorized to use moderation commands.',
        replyToMessageId: plan.replyToMessageId
      });
      log(`moderate: ${plan.actorId} attempted ${plan.moderationAction} without authorization`);
      return { action: 'moderate_unauthorized', plan };
    }

    const targetId = Number(plan.targetId);
    let success = true;
    let error = null;
    try {
      if (plan.moderationAction === 'ban') {
        await telegram.banChatMember({ chatId: plan.chatId, userId: targetId });
      } else if (plan.moderationAction === 'unban') {
        await telegram.unbanChatMember({ chatId: plan.chatId, userId: targetId });
      } else if (plan.moderationAction === 'mute') {
        const untilDate = plan.durationMinutes
          ? Math.floor(Date.now() / 1000) + plan.durationMinutes * 60
          : undefined;
        await telegram.restrictChatMember({ chatId: plan.chatId, userId: targetId, muted: true, untilDate });
      } else if (plan.moderationAction === 'unmute') {
        await telegram.restrictChatMember({ chatId: plan.chatId, userId: targetId, muted: false });
      }
    } catch (err) {
      success = false;
      // The single most likely real-world failure: the bot hasn't been promoted to
      // group admin with ban/restrict rights yet (design doc §9's stated
      // prerequisite) — surface that plainly instead of a raw Telegram error.
      error = err.message && err.message.includes('CHAT_ADMIN_REQUIRED')
        ? 'the bot is not a group admin with the required rights'
        : err.message;
    }

    await backend.reportModerationAction({
      action: plan.moderationAction,
      actorTelegramId: plan.actorId,
      actorName: auth.actorName || plan.actorName,
      targetTelegramId: plan.targetId,
      targetName: plan.targetName,
      chatId: plan.chatId,
      durationMinutes: plan.durationMinutes,
      success,
      error
    });

    const actionLabels = { ban: 'Banned', unban: 'Unbanned', mute: 'Muted', unmute: 'Unmuted' };
    const targetLabel = plan.targetName || plan.targetId;
    const replyText = success
      ? `✅ ${actionLabels[plan.moderationAction]} ${targetLabel}${plan.moderationAction === 'mute' && plan.durationMinutes ? ` for ${plan.durationMinutes} minute(s)` : ''}.`
      : `❌ Failed to ${plan.moderationAction} ${targetLabel}: ${error}`;
    await telegram.sendMessage({ chatId: plan.chatId, text: replyText, replyToMessageId: plan.replyToMessageId });
    log(`moderate: ${plan.actorId} ${plan.moderationAction} ${plan.targetId} — ${success ? 'ok' : `FAILED (${error})`}`);
    return { action: 'moderate_result', success, plan };
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
    log(`intake: rejected — ${msg} (input: "${plan.request.text.slice(0, 120)}")`);
    return { action: 'rejected', result };
  }

  const fwdNote = plan.request.forwardedFrom ? ` [fwd from: ${plan.request.forwardedFrom}]` : '';
  log(`intake: accepted ${result.request.requestId} (${plan.request.text})${fwdNote}`);
  if (config.ackOnIntake) {
    const operators = (result.request.targetOperators || []).join(', ') || 'operator';
    let ackText = `✅ Request received — sending to ${operators}. Reply will be posted here when received.`;
    // Group-registration gate soft-nag (security-hardening v1 follow-on): the
    // sender isn't registered yet but the grace window is still open, so the
    // request went through — nudge once per sender per bridge run rather than
    // on every message, same dedupe shape as reportedUnauthorizedSenders.
    if (result.registrationNote && !reportedRegistrationNudges.has(plan.request.requesterId)) {
      reportedRegistrationNudges.add(plan.request.requesterId);
      ackText += `\n\n${result.registrationNote}`;
    }
    await telegram.sendMessage({
      chatId: plan.request.chatId,
      text: ackText,
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

// Ask the backend which requests are currently terminal (TIMEOUT/FAILED) so the caller can
// seed its "already notified" set and avoid re-announcing old failures after a restart.
// Single attempt — the caller (start.js's poll loop) retries every cycle until this succeeds,
// reusing the loop's own cadence instead of a separate backoff schedule. Returns null (not an
// empty Set) on failure so the caller can tell "nothing to seed" apart from "couldn't ask" —
// treating a failed seed as an empty Set is exactly the bug that caused every old timeout to
// be re-announced at once after a restart.
async function seedNotifiedTimeouts({ backend, log = () => {} }) {
  try {
    const existing = await backend.listRecentRequests();
    const seeded = new Set();
    for (const r of existing) {
      if (['TIMEOUT', 'FAILED'].includes(r.status)) seeded.add(r.requestId);
    }
    log(`posting loop: seeded ${seeded.size} already-notified timeout(s)`);
    return seeded;
  } catch (e) {
    log(`posting loop: seed attempt failed — ${e.message}`);
    return null;
  }
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

module.exports = { buildMention, planIntake, handleIntake, postApprovedReplies, postLiveEdits, notifyTimeouts, seedNotifiedTimeouts, shouldSuppressGroupReply };
