'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMention, planIntake, handleIntake, postApprovedReplies, shouldSuppressGroupReply } = require('../telegram-bridge/bridge');

const CONFIG = {
  groupChatId: '-1001234567890',
  authorizedUsers: { '777888999': { name: 'Officer Rahim' } },
  replyToUnauthorized: true,
  ackOnIntake: false
};

function fakeTelegram() {
  const sent = [];
  return {
    sent,
    sendMessage: async (m) => { sent.push({ kind: 'message', ...m }); return { message_id: 1 }; },
    sendThreadedReply: async (m) => { sent.push({ kind: 'reply', ...m }); return { message_id: 555 }; }
  };
}

test('buildMention spans the leading @Name line with the requester id', () => {
  const mention = buildMention('@Officer Rahim\nReply for...', '777888999');
  assert.deepEqual(mention, { offset: 0, length: '@Officer Rahim'.length, userId: '777888999' });
});

test('buildMention returns null without an @-line or id', () => {
  assert.equal(buildMention('No tag here', '1'), null);
  assert.equal(buildMention('@Name', null), null);
});

test('planIntake ignores messages from other chats', () => {
  const plan = planIntake({ text: 'LRL 0171', chat: { id: '-999' }, from: { id: 1 }, message_id: 5 }, CONFIG);
  assert.equal(plan.action, 'ignore');
});

test('handleIntake reports a wrong-chat message once per distinct chat id', async () => {
  const telegram = fakeTelegram();
  const reported = [];
  const backend = {
    reportChatMismatch: async (detail) => { reported.push(detail); }
  };
  const reportedMismatchChatIds = new Set();
  const message = { text: 'LRL 0171', chat: { id: '-999', title: 'Some Other Group' }, from: { id: 1 }, message_id: 5 };

  const first = await handleIntake(message, { config: CONFIG, backend, telegram, reportedMismatchChatIds });
  assert.equal(first.action, 'ignore');
  assert.equal(reported.length, 1);
  assert.deepEqual(reported[0], {
    chatId: '-999',
    chatTitle: 'Some Other Group',
    configuredGroupChatId: CONFIG.groupChatId
  });

  await handleIntake(message, { config: CONFIG, backend, telegram, reportedMismatchChatIds });
  assert.equal(reported.length, 1, 'should not report the same chat id twice');
});

test('planIntake denies unknown users by default', () => {
  const plan = planIntake(
    { text: 'LRL 01712345678', chat: { id: CONFIG.groupChatId }, from: { id: 555 }, message_id: 5 },
    CONFIG
  );
  assert.equal(plan.action, 'unauthorized');
});

test('planIntake builds a telegram submit plan for authorized users', () => {
  const plan = planIntake(
    { text: 'LRL 01712345678', chat: { id: CONFIG.groupChatId }, from: { id: 777888999 }, message_id: 42 },
    CONFIG
  );
  assert.equal(plan.action, 'submit');
  assert.equal(plan.request.channel, 'telegram');
  assert.equal(plan.request.chatId, CONFIG.groupChatId);
  assert.equal(plan.request.sourceMessageId, 42);
  assert.equal(plan.request.requesterId, '777888999');
  assert.equal(plan.request.requesterName, 'Officer Rahim');
});

test('handleIntake submits accepted requests and stays quiet by default', async () => {
  const telegram = fakeTelegram();
  const submissions = [];
  const backend = {
    submitRequest: async (p) => { submissions.push(p); return { ok: true, request: { requestId: 'REQ-1' } }; }
  };
  const res = await handleIntake(
    { text: 'LRL 01712345678', chat: { id: CONFIG.groupChatId }, from: { id: 777888999 }, message_id: 42 },
    { config: CONFIG, backend, telegram }
  );
  assert.equal(res.action, 'submitted');
  assert.equal(submissions.length, 1);
  assert.equal(telegram.sent.length, 0);
});

test('handleIntake relays a backend rejection back into the thread', async () => {
  const telegram = fakeTelegram();
  const backend = {
    submitRequest: async () => ({ ok: false, replyText: 'Invalid request format.' })
  };
  const res = await handleIntake(
    { text: 'garbage', chat: { id: CONFIG.groupChatId }, from: { id: 777888999 }, message_id: 7 },
    { config: CONFIG, backend, telegram }
  );
  assert.equal(res.action, 'rejected');
  assert.equal(telegram.sent[0].text, 'Invalid request format.');
  assert.equal(telegram.sent[0].replyToMessageId, 7);
});

test('handleIntake stays quiet for authorization-style backend rejections', async () => {
  const telegram = fakeTelegram();
  const backend = {
    submitRequest: async () => ({
      ok: false,
      errorCode: 'REQUEST_DENIED_UNKNOWN_USER',
      replyText: 'You are not an authorized requester.'
    })
  };
  const res = await handleIntake(
    { text: 'LRL 01712345678', chat: { id: CONFIG.groupChatId }, from: { id: 777888999 }, message_id: 9 },
    { config: CONFIG, backend, telegram }
  );
  assert.equal(res.action, 'rejected');
  assert.equal(telegram.sent.length, 0);
});

test('bridge-level unauthorized intake no longer replies into the group, but is reported once', async () => {
  const telegram = fakeTelegram();
  const reported = [];
  const backend = {
    submitRequest: async () => ({ ok: true }),
    reportUnauthorizedAttempt: async (detail) => { reported.push(detail); }
  };
  const reportedUnauthorizedSenders = new Set();
  const message = { text: 'LRL 01712345678', chat: { id: CONFIG.groupChatId, type: 'group' }, from: { id: 555 }, message_id: 5 };

  const first = await handleIntake(message, { config: CONFIG, backend, telegram, reportedUnauthorizedSenders });
  assert.equal(first.action, 'unauthorized');
  assert.equal(telegram.sent.length, 0);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].chatId, CONFIG.groupChatId);
  assert.equal(reported[0].chatType, 'group');
  assert.equal(reported[0].fromId, '555');

  await handleIntake(message, { config: CONFIG, backend, telegram, reportedUnauthorizedSenders });
  assert.equal(reported.length, 1, 'should not report the same chat+sender twice');
});

test('planIntake always requires authorization for private chats, regardless of group allowlist', () => {
  const unauthorizedDm = planIntake(
    { text: 'LRL 01712345678', chat: { id: '555', type: 'private' }, from: { id: 555 }, message_id: 1 },
    CONFIG
  );
  assert.equal(unauthorizedDm.action, 'unauthorized');
  assert.equal(unauthorizedDm.replyText, null, 'private DMs never get a reply, unlike the group case');

  const authorizedDm = planIntake(
    { text: 'LRL 01712345678', chat: { id: '777888999', type: 'private' }, from: { id: 777888999 }, message_id: 2 },
    CONFIG
  );
  assert.equal(authorizedDm.action, 'submit');
  assert.equal(authorizedDm.request.chatId, '777888999');
  assert.equal(authorizedDm.request.requesterName, 'Officer Rahim');
});

test('handleIntake routes an authorized private DM submission and ack back to the private chat, not the group', async () => {
  const telegram = fakeTelegram();
  const backend = {
    submitRequest: async () => ({ ok: true, request: { requestId: 'REQ-1', targetOperators: ['GP'] } })
  };
  const res = await handleIntake(
    { text: 'LRL 01712345678', chat: { id: '777888999', type: 'private' }, from: { id: 777888999 }, message_id: 3 },
    { config: { ...CONFIG, ackOnIntake: true }, backend, telegram }
  );
  assert.equal(res.action, 'submitted');
  assert.equal(telegram.sent.length, 1);
  assert.equal(telegram.sent[0].chatId, '777888999', 'ack must go to the private chat, never the group');
});

test('handleIntake routes a rejected private DM reply back to the private chat, not the group', async () => {
  const telegram = fakeTelegram();
  const backend = {
    submitRequest: async () => ({ ok: false, replyText: 'Invalid request format.' })
  };
  const res = await handleIntake(
    { text: 'garbage', chat: { id: '777888999', type: 'private' }, from: { id: 777888999 }, message_id: 4 },
    { config: CONFIG, backend, telegram }
  );
  assert.equal(res.action, 'rejected');
  assert.equal(telegram.sent[0].chatId, '777888999');
});

test('shouldSuppressGroupReply recognizes authorization error codes', () => {
  assert.equal(shouldSuppressGroupReply({ errorCode: 'REQUEST_DENIED_UNKNOWN_USER' }), true);
  assert.equal(shouldSuppressGroupReply({ errorCode: 'REQUEST_DENIED_DISABLED_USER' }), true);
  assert.equal(shouldSuppressGroupReply({ errorCode: 'REQUEST_DENIED_UNAUTHORIZED_OPERATOR' }), true);
  assert.equal(shouldSuppressGroupReply({ errorCode: 'MIXED_REQUEST_TYPES' }), false);
});

test('postApprovedReplies posts telegram drafts threaded + mentioned, then confirms', async () => {
  const telegram = fakeTelegram();
  const marked = [];
  const backend = {
    listApprovedReplies: async () => [
      {
        id: 'wa_1', requestId: 'REQ-1', channel: 'telegram', chatId: CONFIG.groupChatId,
        sourceMessageId: 42, requesterId: '777888999', replyText: '@Officer Rahim\nReply body'
      },
      { id: 'wa_2', channel: 'manual', replyText: '@X\nignored' }
    ],
    markReplyPosted: async (id, msgId) => { marked.push({ id, msgId }); }
  };
  const posted = await postApprovedReplies({ backend, telegram });
  assert.deepEqual(posted, ['wa_1']);
  assert.equal(telegram.sent[0].kind, 'reply');
  assert.equal(telegram.sent[0].replyToMessageId, 42);
  assert.equal(telegram.sent[0].mention.userId, '777888999');
  assert.deepEqual(marked, [{ id: 'wa_1', msgId: 555 }]);
});

test('postApprovedReplies leaves a draft queued if posting throws', async () => {
  const telegram = {
    sendThreadedReply: async () => { throw new Error('network down'); }
  };
  let markedCalled = false;
  const backend = {
    listApprovedReplies: async () => [
      { id: 'wa_1', channel: 'telegram', chatId: '-1', sourceMessageId: 1, requesterId: '1', replyText: '@A\nx' }
    ],
    markReplyPosted: async () => { markedCalled = true; }
  };
  const posted = await postApprovedReplies({ backend, telegram });
  assert.deepEqual(posted, []);
  assert.equal(markedCalled, false);
});
