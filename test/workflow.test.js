'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AutomationStore } = require('../src/store');
const { OperatorQueue } = require('../src/queue');
const { SmsGatewayClient } = require('../src/smsGateway');
const { AutomationService } = require('../src/service');
const { parseRequestText } = require('../src/parser');
const { STATUSES } = require('../src/domain');

function createHarness(gatewayConfig = {}) {
  const store = new AutomationStore(gatewayConfig);
  const queue = new OperatorQueue(store);
  const smsGateway = new SmsGatewayClient(store, queue);
  const service = new AutomationService({ store, queue, smsGateway });
  return { store, queue, smsGateway, service };
}

test('parses strict operator request format', () => {
  const parsed = parseRequestText('@bot LRL 01712345678');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requestType, 'LRL');
  assert.equal(parsed.payload, '01712345678');
  assert.deepEqual(parsed.targetOperators, ['GP']);
});

test('rejects invalid request format with correction message', () => {
  const parsed = parseRequestText('hello world');
  assert.equal(parsed.ok, false);
  assert.match(parsed.correctionMessage, /Valid request types: LRL, LCL, MS-NID, NID-MS, IMEI-MS/);
});

test('submits request, sends SMS, and waits for operator reply', async () => {
  const { store, service } = createHarness();
  const result = await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '8801700000000',
    text: 'LRL 01712345678'
  });

  assert.equal(result.ok, true);
  assert.equal(result.request.status, STATUSES.WAITING_OPERATOR_REPLY);
  assert.equal(store.smsOutbox.length, 1);
  assert.equal(store.smsOutbox[0].gatewayId, 'GP_PHONE_01');
  assert.equal(store.smsOutbox[0].messageBody, 'LRL 01712345678');
  assert.match(result.request.silentReference, /^SR/);
});

test('keeps second same-operator request queued while first is pending', async () => {
  const { store, service } = createHarness();
  await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '8801700000000',
    text: 'LRL 01712345678'
  });
  await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Karim',
    requesterWhatsappId: '8801800000000',
    text: 'LRL 01798765432'
  });

  assert.equal(store.smsOutbox.length, 1);
  const second = store.listRequests().find((request) => request.requesterName === 'Officer Karim');
  assert.equal(second.status, STATUSES.QUEUED);
});

test('matches operator reply and drafts tagged WhatsApp response', async () => {
  const { service } = createHarness();
  const submitted = await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '8801700000000',
    text: 'LRL 01712345678'
  });

  const inbound = service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'LRL cell location'
  });

  assert.equal(inbound.ok, true);
  assert.equal(inbound.request.requestId, submitted.request.requestId);
  assert.equal(inbound.request.status, STATUSES.NEEDS_MANUAL_REVIEW);
  assert.match(inbound.whatsappReply.replyText, /@Officer Rahim/);
  assert.match(inbound.whatsappReply.replyText, /REQ-/);
});

test('manual approval completes request after reply review', async () => {
  const { service } = createHarness();
  const submitted = await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '8801700000000',
    text: 'LRL 01712345678'
  });
  service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'LRL cell location'
  });

  const completed = await service.approveWhatsAppReply(submitted.request.requestId);
  assert.equal(completed.status, STATUSES.COMPLETED);
});

test('approval dispatches next queued request for same operator', async () => {
  const { store, service } = createHarness();
  const first = await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '8801700000000',
    text: 'LRL 01712345678'
  });
  await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Karim',
    requesterWhatsappId: '8801800000000',
    text: 'LRL 01798765432'
  });
  service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'LRL cell location'
  });

  await service.approveWhatsAppReply(first.request.requestId);

  assert.equal(store.smsOutbox.length, 2);
  assert.equal(store.smsOutbox[1].messageBody, 'LRL 01798765432');
});

test('MS-NID request is sent to all operator gateways', async () => {
  const { store, service } = createHarness();
  const result = await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '8801700000000',
    text: 'MS-NID 01712345678'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.request.targetOperators, ['GP', 'ROBI', 'BANGLALINK']);
  assert.equal(store.smsOutbox.length, 3);
  assert.deepEqual(
    store.smsOutbox.map((row) => row.gatewayId).sort(),
    ['BANGLALINK_PHONE_01', 'GP_PHONE_01', 'ROBI_PHONE_01']
  );
});

test('all-operator request waits for every operator reply before review', async () => {
  const { service } = createHarness();
  const submitted = await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '8801700000000',
    text: 'MS-NID 01712345678'
  });

  const firstReply = service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'NID 1234567890'
  });
  assert.equal(firstReply.request.status, STATUSES.WAITING_OPERATOR_REPLY);

  service.receiveSmsWebhook({
    gatewayId: 'ROBI_PHONE_01',
    from: '12345',
    body: 'NID 1234567890'
  });
  const finalReply = service.receiveSmsWebhook({
    gatewayId: 'BANGLALINK_PHONE_01',
    from: '12345',
    body: 'NID 1234567890'
  });

  assert.equal(finalReply.request.status, STATUSES.NEEDS_MANUAL_REVIEW);
});

test('partial all-operator reply cannot be approved early', async () => {
  const { service } = createHarness();
  const submitted = await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '8801700000000',
    text: 'MS-NID 01712345678'
  });
  service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'NID 1234567890'
  });

  await assert.rejects(
    () => service.approveWhatsAppReply(submitted.request.requestId),
    /not ready for WhatsApp reply approval/
  );
});

test('ignores junk SMS from untrusted sender before analysis', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '8801700000000',
    text: 'LRL 01712345678'
  });

  const ignored = service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: 'PROMO',
    body: 'Buy one get one offer'
  });

  assert.equal(ignored.ignored, true);
  assert.equal(ignored.inbox.matchedRequestId, null);
  assert.equal(store.getRequest(submitted.request.requestId).status, STATUSES.WAITING_OPERATOR_REPLY);
});

test('gateway config apiKey is sent as Authorization header', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, text: async () => '{"ok":true}' };
  };

  try {
    const { service } = createHarness({
      GP: {
        gatewayUrl: 'http://phone-gp.local:8080',
        sendPath: '/send-sms',
        apiKey: 'secret-token',
        trustedSenders: ['12345']
      }
    });
    await service.submitWhatsAppRequest({
      whatsappGroupId: 'operations',
      requesterName: 'Officer Rahim',
      requesterWhatsappId: '8801700000000',
      text: 'LRL 01712345678'
    });

    assert.equal(calls[0].options.headers.authorization, 'Bearer secret-token');
  } finally {
    global.fetch = originalFetch;
  }
});

test('requester authorization is preserved and enforced', async () => {
  const { store, service } = createHarness();
  store.upsertUser({
    whatsappId: '8801700000000',
    displayName: 'Officer Rahim',
    allowedOperators: ['ROBI']
  });

  const blocked = await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '8801700000000',
    text: 'LRL 01712345678'
  });

  assert.equal(blocked.ok, false);
  assert.match(blocked.errors[0], /not authorized for GP/);
});

test('matches branded operator sender ID without destination number equality', async () => {
  const { service } = createHarness({
    GP: {
      trustedSenders: ['12345', 'GP-INFO']
    }
  });
  const submitted = await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '8801700000000',
    text: 'LRL 01712345678'
  });

  const inbound = service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: 'GP-INFO',
    body: 'LRL cell location'
  });

  assert.equal(inbound.ok, true);
  assert.equal(inbound.request.requestId, submitted.request.requestId);
});

test('timeout sweep dispatches next queued request for same operator', async () => {
  const { store, service } = createHarness();
  await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '8801700000000',
    text: 'LRL 01712345678'
  });
  await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Karim',
    requesterWhatsappId: '8801800000000',
    text: 'LRL 01798765432'
  });

  const waiting = store.listRequests().find((request) => request.requesterName === 'Officer Rahim');
  store.smsOutbox[0].sentAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();

  const timedOut = await service.timeoutWaitingRequests();
  assert.equal(timedOut.length, 1);
  assert.equal(timedOut[0].status, STATUSES.TIMEOUT);
  assert.equal(store.smsOutbox.length, 2);
  assert.equal(store.smsOutbox[1].messageBody, 'LRL 01798765432');
});

test('request IDs stay unique across store restarts', () => {
  const first = new AutomationStore();
  const second = new AutomationStore();
  const id1 = first.nextRequestId();
  const id2 = second.nextRequestId();
  assert.notEqual(id1, id2);
});

test('configured gateway receives clean hardbound SMS command over HTTP', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => '{"ok":true}'
    };
  };

  try {
    const { service } = createHarness({
      GP: {
        gatewayUrl: 'http://phone-gp.local:8080',
        sendPath: '/send-sms',
        trustedSenders: ['12345']
      }
    });
    await service.submitWhatsAppRequest({
      whatsappGroupId: 'operations',
      requesterName: 'Officer Rahim',
      requesterWhatsappId: '8801700000000',
      text: 'LRL 01712345678'
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://phone-gp.local:8080/send-sms');
    assert.equal(JSON.parse(calls[0].options.body).message, 'LRL 01712345678');
  } finally {
    global.fetch = originalFetch;
  }
});

test('fan-out with two replies and one timeout finalizes to manual review (not timeout)', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '8801700000000',
    text: 'MS-NID 01712345678'
  });
  const requestId = submitted.request.requestId;

  // GP and ROBI reply; Banglalink stays silent.
  service.receiveSmsWebhook({ gatewayId: 'GP_PHONE_01', from: '12345', body: 'NID 111 GP' });
  service.receiveSmsWebhook({ gatewayId: 'ROBI_PHONE_01', from: '12345', body: 'NID 222 ROBI' });
  assert.equal(store.getRequest(requestId).status, STATUSES.WAITING_OPERATOR_REPLY);

  // Age the Banglalink send past the reply window so only ITS dispatch times out.
  const blOutbox = store.smsOutbox.find((row) => row.gatewayId === 'BANGLALINK_PHONE_01');
  blOutbox.sentAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();

  const finalized = await service.timeoutWaitingRequests();
  const request = store.getRequest(requestId);

  // Derived status: at least one reply arrived, so the request is reviewable — NOT a blanket timeout.
  assert.equal(request.status, STATUSES.NEEDS_MANUAL_REVIEW);
  assert.equal(finalized.length, 1);

  const dispatchStatus = (op) => request.dispatches.find((d) => d.operator === op).status;
  assert.equal(dispatchStatus('GP'), 'REPLY_RECEIVED');
  assert.equal(dispatchStatus('ROBI'), 'REPLY_RECEIVED');
  assert.equal(dispatchStatus('BANGLALINK'), 'TIMEOUT');

  // One combined draft with per-operator sections (replies + the timed-out operator marked).
  const drafts = store.listWhatsAppReplies().filter((r) => r.requestId === requestId);
  assert.equal(drafts.length, 1);
  assert.match(drafts[0].replyText, /GP:/);
  assert.match(drafts[0].replyText, /NID 111 GP/);
  assert.match(drafts[0].replyText, /Banglalink: no reply \(timed out\)/);
});

test('fan-out with no replies times out as a whole', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitWhatsAppRequest({
    whatsappGroupId: 'operations',
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '8801700000000',
    text: 'MS-NID 01712345678'
  });
  for (const row of store.smsOutbox) {
    row.sentAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  }
  const finalized = await service.timeoutWaitingRequests();
  assert.equal(finalized.length, 1);
  assert.equal(store.getRequest(submitted.request.requestId).status, STATUSES.TIMEOUT);
});

test('telegram-channel request carries chat + source message metadata to the draft', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitWhatsAppRequest({
    channel: 'telegram',
    chatId: '-1001234567890',
    sourceMessageId: 42,
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '777888999',
    text: 'LRL 01712345678'
  });

  assert.equal(submitted.request.channel, 'telegram');
  assert.equal(submitted.request.chatId, '-1001234567890');
  assert.equal(submitted.request.sourceMessageId, 42);

  service.receiveSmsWebhook({ gatewayId: 'GP_PHONE_01', from: '12345', body: 'LRL cell location' });

  const draft = store.listWhatsAppReplies({ status: 'DRAFT' }).at(-1);
  assert.equal(draft.channel, 'telegram');
  assert.equal(draft.chatId, '-1001234567890');
  assert.equal(draft.sourceMessageId, 42);
  assert.equal(draft.requesterId, '777888999');
});

test('automated-channel approval defers posting and bridge confirmation completes it', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitWhatsAppRequest({
    channel: 'telegram',
    chatId: '-1001234567890',
    sourceMessageId: 42,
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '777888999',
    text: 'LRL 01712345678'
  });
  service.receiveSmsWebhook({ gatewayId: 'GP_PHONE_01', from: '12345', body: 'LRL cell location' });

  // Approval does NOT complete the request for automated channels — it queues for the bridge.
  await service.approveWhatsAppReply(submitted.request.requestId);
  assert.equal(store.getRequest(submitted.request.requestId).status, STATUSES.NEEDS_MANUAL_REVIEW);
  const queued = store.listWhatsAppReplies({ status: 'APPROVED_FOR_POST' });
  assert.equal(queued.length, 1);

  // Bridge confirms it posted → request completes.
  const completed = await service.markReplyPosted(queued[0].id, { postedMessageId: 100 });
  assert.equal(completed.status, STATUSES.COMPLETED);
  assert.equal(store.getWhatsAppReply(queued[0].id).sentStatus, 'POSTED');
  assert.equal(store.getWhatsAppReply(queued[0].id).postedMessageId, 100);
});

test('manual-channel approval still completes in one step', async () => {
  const { service } = createHarness();
  const submitted = await service.submitWhatsAppRequest({
    requesterName: 'Officer Rahim',
    requesterWhatsappId: '8801700000000',
    text: 'LRL 01712345678'
  });
  service.receiveSmsWebhook({ gatewayId: 'GP_PHONE_01', from: '12345', body: 'LRL cell location' });

  const completed = await service.approveWhatsAppReply(submitted.request.requestId);
  assert.equal(completed.status, STATUSES.COMPLETED);
});

test('registers phone gateway URL dynamically at runtime', () => {
  const { store } = createHarness({
    GP: { gatewayUrl: '', trustedSenders: ['12345'] }
  });

  const gateway = store.registerGateway('GP_PHONE_01', {
    host: '192.168.0.172',
    port: 8080
  });

  assert.equal(gateway.gatewayUrl, 'http://192.168.0.172:8080');
  assert.equal(gateway.status, 'CONFIGURED');
  assert.equal(store.getGateway('GP_PHONE_01').gatewayUrl, 'http://192.168.0.172:8080');
});
