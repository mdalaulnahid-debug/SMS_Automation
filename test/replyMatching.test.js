'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AutomationStore } = require('../src/store');
const { OperatorQueue } = require('../src/queue');
const { SmsGatewayClient } = require('../src/smsGateway');
const { AutomationService } = require('../src/service');
const { STATUSES } = require('../src/domain');
const { inferReplyFamilies, replyContradictsPayload, analyzeOperatorReply } = require('../src/replyAnalyzer');

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

test('replyContradictsPayload flags IMEI replies whose IMEIs are disjoint from the request', () => {
  const request = { requestType: 'IMEI-MS', payload: '866129064492044 866129064492051' };
  // reply echoes only OTHER requests' IMEIs → contradiction (2026-07-05 cross-match)
  assert.equal(replyContradictsPayload(request, 'Sorry No records found for IMEI: 358197546383805 [GP]'), true);
  // reply echoes one of the request's own IMEIs → no contradiction
  assert.equal(replyContradictsPayload(request, 'IMEI: 866129064492044 No data found. [Robi]'), false);
  // reply echoes no IMEIs at all (bare no-data) → no opinion, preserve type+timing behavior
  assert.equal(replyContradictsPayload(request, 'No data available - Banglalink'), false);
});

test('content gate: an IMEI reply for a different request is not cross-attached (blackout regression)', async () => {
  const { store, service } = createHarness();
  const reqA = await service.submitRequest({
    chatId: 'operations', requesterName: 'Addl SP Crime & Ops', requesterId: '8914564310',
    text: 'IMEI-MS 864284063426220 864284063426238'
  });
  const reqB = await service.submitRequest({
    chatId: 'operations', requesterName: 'Addl SP Crime & Ops', requesterId: '8914564310',
    text: 'IMEI-MS 866129064492044 866129064492051'
  });

  // GP replies with ONLY reqA's IMEIs, while both A and B are pending on GP.
  const gpReply = service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01', from: '12345',
    body: 'IMEI: 864284063426220 864284063426220, 8801603853502, 20251130 [GP] Sorry No records found for IMEI: 864284063426238 [GP]'
  });
  // must attach to A (whose IMEIs it contains), never B
  assert.equal(gpReply.request?.requestId, reqA.request.requestId);

  // A GP reply echoing IMEIs that belong to NEITHER request must go unmatched, not cross-attach.
  const orphan = service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01', from: '12345',
    body: 'Sorry No records found for IMEI: 358197546383805 [GP] IMEI: 869206088883767 869206088883760, 8801745235710, 20260604 [GP]'
  });
  assert.equal(orphan.ok, false);
  assert.equal(orphan.needsManualReview, true);
  assert.ok(store.auditLogs.some((r) => r.action === 'SMS_REPLY_PAYLOAD_MISMATCH'));
  // reqB never received GP's reply
  assert.ok(!store.getRequest(reqB.request.requestId).receivedOperators.includes('GP'));
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

// --- patternMatched/confidence drift regression (2026-08-02 investigation) ---
// inferReplyFamilies (STRONG_REPLY_FAMILY_PATTERNS) recognized real operator
// templates like "no rl info found" that analyzeOperatorReply's own
// patternMatched check (REPLY_PATTERNS, a much smaller set) did not — so a
// reply the system had already correctly classified could still score
// confidence UNKNOWN and get silently dropped by the auto-matcher whenever
// more than one request was open on the same gateway. Live investigation
// found this explained the large majority of a growing production backlog.

test('analyzeOperatorReply treats a STRONG_REPLY_FAMILY_PATTERNS match as patternMatched, even when REPLY_PATTERNS misses it and payload does not match', () => {
  const request = { requestType: 'LRL', payload: '01712345678', operator: 'GP', silentReference: 'REF-UNRELATED' };
  // Generic negative LRL reply for a DIFFERENT number than this request's own —
  // payload can't help here, this only resolves via type-pattern recognition.
  const result = analyzeOperatorReply({ request, messageBody: 'No RL Info Found of 1798765432 [GP]' });
  assert.equal(result.payloadMatched, false, 'sanity check — this case must not be rescued by payload matching');
  assert.equal(result.patternMatched, true, '"no rl info found" is a real LRL template the strong classifier already recognizes');
  assert.notEqual(result.confidence, 'UNKNOWN');
});

test('a generic negative reply now auto-matches the correct request among multiple open on the same gateway (real bug reproduction)', async () => {
  const { store, service } = createHarness();
  const lrl = await service.submitRequest({
    chatId: 'operations', requesterName: 'Officer Rahim', requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });
  // A second, differently-typed request open on the SAME gateway at the same time —
  // this is what previously produced the "ambiguous" fork in service.js.
  await service.submitRequest({
    chatId: 'operations', requesterName: 'Officer Karim', requesterId: '8801800000000',
    text: 'NID-MS 1234567890123'
  });

  // Negative LRL reply that doesn't echo any specific number — before the
  // patternMatched fix, this fell to manual review/unmatched because
  // confidence was UNKNOWN and the auto-pick gate requires score > 0.
  const reply = service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'No RL Info Found of 1798765432 [GP]'
  });

  assert.equal(reply.ok, true, 'must auto-match now instead of falling to manual review');
  assert.equal(reply.request.requestId, lrl.request.requestId);
});

test('genuine ambiguity (same type, no distinguishing signal) still correctly falls to manual review — the fix does not introduce guessing', async () => {
  const { store, service } = createHarness();
  const first = await service.submitRequest({
    chatId: 'operations', requesterName: 'Officer Rahim', requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });
  const second = await service.submitRequest({
    chatId: 'operations', requesterName: 'Officer Karim', requesterId: '8801800000000',
    text: 'LRL 01798765432'
  });

  // Same request type as BOTH open requests, echoes neither number — nothing
  // should be able to disambiguate this, and it must not coin-flip a pick.
  const reply = service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'No RL Info Found of 1911111111 [GP]'
  });

  assert.equal(reply.ok, false);
  assert.equal(reply.needsManualReview, true);
  assert.equal(store.getRequest(first.request.requestId).status, STATUSES.WAITING_OPERATOR_REPLY);
  assert.equal(store.getRequest(second.request.requestId).status, STATUSES.WAITING_OPERATOR_REPLY);
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
