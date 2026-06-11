'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMention, planIntake, handleIntake, postApprovedReplies } = require('../telegram-bridge/bridge');

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
  assert.equal(plan.request.requesterWhatsappId, '777888999');
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
