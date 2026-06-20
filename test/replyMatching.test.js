'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AutomationStore } = require('../src/store');
const { OperatorQueue } = require('../src/queue');
const { SmsGatewayClient } = require('../src/smsGateway');
const { AutomationService } = require('../src/service');
const { STATUSES } = require('../src/domain');
const { inferReplyFamilies } = require('../src/replyAnalyzer');

function createHarness(gatewayConfig = {}, serviceOptions = {}) {
  const store = new AutomationStore(gatewayConfig);
  const queue = new OperatorQueue(store);
  const smsGateway = new SmsGatewayClient(store, queue);
  const service = new AutomationService({ store, queue, smsGateway, ...serviceOptions });
  return { store, queue, smsGateway, service };
}

test('inferReplyFamilies recognizes "no records found for IMEI" mid-sentence (line-anchor regression)', () => {
  const result = inferReplyFamilies('Sorry No records found for IMEI: 353917104327090 [GP]');
  assert.ok(result.strongTypes.includes('IMEI-MS'));
});

test('inferReplyFamilies recognizes "no records found for NID" mid-sentence (line-anchor regression)', () => {
  const result = inferReplyFamilies('Sorry No records found for NID: 1234567890123 [GP]');
  assert.ok(result.strongTypes.includes('NID-MS'));
});

test('an unrelated IMEI "no records" reply does not steal an open LRL request', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Addl SP Crime & Ops',
    requesterId: '8914564310',
    text: 'LRL 01718589986'
  });

  const wrongReply = service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'Sorry No records found for IMEI: 353917104327090 [GP]'
  });

  assert.equal(wrongReply.ok, false);
  assert.equal(wrongReply.needsManualReview, true);
  assert.equal(store.getRequest(submitted.request.requestId).status, STATUSES.WAITING_OPERATOR_REPLY);
  assert.ok(store.auditLogs.some((row) => row.action === 'SMS_REPLY_TYPE_MISMATCH'));

  const realReply = service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'MSISDN: 8801718589986\nLastActiveDateTime: 2026-06-20 17:13:56\nLatitude: 23.7529\nLongitude: 90.3814 [GP]'
  });

  assert.equal(realReply.ok, true);
  assert.equal(realReply.request.requestId, submitted.request.requestId);
  assert.equal(realReply.request.status, STATUSES.NEEDS_MANUAL_REVIEW);
  assert.match(realReply.replyDraft.replyText, /Latitude: 23\.7529/);
});

test('rankReplyCandidates surfaces a completed request as the top-scored candidate for an orphaned reply', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });
  const requestId = submitted.request.requestId;

  // Simulate the historical bug: a same-type-but-wrong reply (no payload check in the
  // single-pending path) got auto-matched and the request was approved/completed
  // before the real reply for this exact number ever arrived.
  const wrongInboundResult = service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'No Radio Location Found [GP]'
  });
  assert.equal(wrongInboundResult.ok, true);
  const wrongInbox = store.smsInbox.find((row) => row.id === wrongInboundResult.inbox.id);
  await service.approveReply(requestId);
  assert.equal(store.getRequest(requestId).status, STATUSES.COMPLETED);

  // The real reply arrives late, with nothing left to auto-match against.
  const orphanInbox = store.addSmsInbox({
    gatewayId: 'GP_PHONE_01',
    senderNumber: '12345',
    messageBody: 'MSISDN: 8801712345678\nLastActiveDateTime: 2026-06-20 17:13:56\nLatitude: 23.7529\nLongitude: 90.3814 [GP]'
  });

  const candidates = service.rankReplyCandidates(orphanInbox.id);
  assert.ok(candidates.length > 0);
  assert.equal(candidates[0].requestId, requestId);
  assert.equal(candidates[0].status, STATUSES.COMPLETED);
  assert.ok(candidates[0].score > 0);
});

test('correctMatch re-attaches the real reply, detaches the wrong one, and issues a correction draft', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });
  const requestId = submitted.request.requestId;

  const wrongInboundResult = service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'No Radio Location Found [GP]'
  });
  const wrongInbox = store.smsInbox.find((row) => row.id === wrongInboundResult.inbox.id);
  await service.approveReply(requestId);

  const orphanInbox = store.addSmsInbox({
    gatewayId: 'GP_PHONE_01',
    senderNumber: '12345',
    messageBody: 'MSISDN: 8801712345678\nLastActiveDateTime: 2026-06-20 17:13:56\nLatitude: 23.7529\nLongitude: 90.3814 [GP]'
  });

  const result = service.correctMatch(orphanInbox.id, requestId);

  assert.equal(result.ok, true);
  assert.equal(result.correctedFromInboxId, wrongInbox.id);
  assert.match(result.replyDraft.replyText, /Correction/);
  assert.match(result.replyDraft.replyText, /Latitude: 23\.7529/);
  assert.doesNotMatch(result.replyDraft.replyText, /No Radio Location Found/);

  const refreshedWrongInbox = store.smsInbox.find((row) => row.id === wrongInbox.id);
  assert.equal(refreshedWrongInbox.matchedRequestId, null);
  assert.equal(refreshedWrongInbox.analysis.correctedAway, true);

  const refreshedOrphanInbox = store.smsInbox.find((row) => row.id === orphanInbox.id);
  assert.equal(refreshedOrphanInbox.matchedRequestId, requestId);

  assert.ok(store.auditLogs.some((row) => row.action === 'MANUAL_REMATCH_CORRECTION' && row.requestId === requestId));
});
