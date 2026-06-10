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
