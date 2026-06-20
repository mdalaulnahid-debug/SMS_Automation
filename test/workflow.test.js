'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AutomationStore } = require('../src/store');
const { OperatorQueue } = require('../src/queue');
const { SmsGatewayClient } = require('../src/smsGateway');
const { AutomationService } = require('../src/service');
const { parseRequestText } = require('../src/parser');
const { STATUSES } = require('../src/domain');

function createHarness(gatewayConfig = {}, serviceOptions = {}) {
  const store = new AutomationStore(gatewayConfig);
  const queue = new OperatorQueue(store);
  const smsGateway = new SmsGatewayClient(store, queue);
  const service = new AutomationService({ store, queue, smsGateway, ...serviceOptions });
  return { store, queue, smsGateway, service };
}

function assertInvalidParse(input, expectedCode, expectedMessagePattern) {
  const parsed = parseRequestText(input);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.errorCode, expectedCode);
  if (expectedMessagePattern) {
    assert.match(parsed.replyText, expectedMessagePattern);
  }
}

test('parses canonicalized multi-identifier request format', () => {
  const parsed = parseRequestText('@bot   lrl   01712345678   01799999999');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requestType, 'LRL');
  assert.deepEqual(parsed.identifiers, ['01712345678', '01799999999']);
  assert.equal(parsed.payload, '01712345678 01799999999');
  assert.equal(parsed.canonicalRequestText, 'LRL 01712345678 01799999999');
  assert.deepEqual(parsed.targetOperators, ['GP']);
});

test('parses all-operator request with five identifiers exactly', () => {
  const parsed = parseRequestText('NID-MS 4246780000 5246780000 6246780000 7246780000 8246780000');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requestType, 'NID-MS');
  assert.equal(parsed.canonicalPayload, '4246780000 5246780000 6246780000 7246780000 8246780000');
  assert.deepEqual(parsed.targetOperators, ['GP', 'ROBI', 'BANGLALINK']);
});

test('rejects invalid request format with normalized correction message', () => {
  assertInvalidParse('hello world', 'UNSUPPORTED_COMMAND', /Supported commands: IMEI-MS, LCL, LRL, MS-NID, NID-MS/);
});

test('rejects empty request message', () => {
  assertInvalidParse('   ', 'EMPTY_MESSAGE', /Use English capital command/);
});

test('rejects request with command but no identifiers', () => {
  assertInvalidParse('LCL', 'MISSING_IDENTIFIERS', /at least one identifier/i);
});

test('rejects more than five identifiers', () => {
  assertInvalidParse(
    'LCL 01710000000 01710000001 01710000002 01710000003 01710000004 01710000005',
    'TOO_MANY_IDENTIFIERS',
    /Maximum 5 identifiers/
  );
});

test('rejects repeated command keyword in same message', () => {
  assertInvalidParse('MS-NID 01810000000 MS-NID 01820000001', 'REPEATED_COMMAND', /Do not repeat/);
});

test('rejects mixed request types in same message', () => {
  assertInvalidParse('LCL 01710000000 LRL 01720000001', 'MIXED_REQUEST_TYPES', /Only one request type/);
});

test('accepts +880 country code prefix instead of rejecting it', () => {
  const parsed = parseRequestText('LCL +8801710000000');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.identifiers, ['01710000000']);
});

test('rejects identifiers with slash separator', () => {
  assertInvalidParse('NID-MS 4246780000/5246780000', 'INVALID_IDENTIFIER_CHARS', /digits only/);
});

test('rejects invalid identifier shape after tokenization', () => {
  assertInvalidParse('LCL 01710 000000', 'INVALID_IDENTIFIER_FORMAT', /too short.*5 digits/);
});

test('rejects same request type across mixed operators', () => {
  assertInvalidParse('LCL 01710000000 01820000001', 'OPERATOR_MISMATCH', /multiple operators/);
});

// Auto-correct type-token typo tests

test('auto-corrects split hyphenated command: MS NID → MS-NID', () => {
  const parsed = parseRequestText('MS NID 01625242040');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requestType, 'MS-NID');
  assert.deepEqual(parsed.identifiers, ['01625242040']);
  assert.equal(parsed.canonicalRequestText, 'MS-NID 01625242040');
  assert.ok(parsed.correctionMessage);
});

test('auto-corrects split hyphenated command: NID MS → NID-MS', () => {
  const parsed = parseRequestText('NID MS 4246780000');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requestType, 'NID-MS');
  assert.deepEqual(parsed.identifiers, ['4246780000']);
  assert.ok(parsed.correctionMessage);
});

test('auto-corrects split hyphenated command: IMEI MS → IMEI-MS', () => {
  const parsed = parseRequestText('IMEI MS 35391109000000');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requestType, 'IMEI-MS');
  assert.deepEqual(parsed.identifiers, ['35391109000000']);
  assert.ok(parsed.correctionMessage);
});

test('auto-corrects glued prefix: LRL01308218563 → LRL 01308218563', () => {
  const parsed = parseRequestText('LRL01308218563');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requestType, 'LRL');
  assert.deepEqual(parsed.identifiers, ['01308218563']);
  assert.equal(parsed.canonicalRequestText, 'LRL 01308218563');
  assert.ok(parsed.correctionMessage);
});

test('auto-corrects glued prefix with hyphen in number: LRL01308-218563 → LRL 01308218563', () => {
  const parsed = parseRequestText('LRL01308-218563');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requestType, 'LRL');
  assert.deepEqual(parsed.identifiers, ['01308218563']);
  assert.ok(parsed.correctionMessage);
});

test('auto-corrects glued compound prefix: MSNID01625242040 → MS-NID 01625242040', () => {
  const parsed = parseRequestText('MSNID01625242040');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requestType, 'MS-NID');
  assert.deepEqual(parsed.identifiers, ['01625242040']);
  assert.ok(parsed.correctionMessage);
});

test('auto-corrects lowercase command: lrl → LRL', () => {
  const parsed = parseRequestText('lrl 01712345678');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requestType, 'LRL');
  assert.equal(parsed.canonicalRequestText, 'LRL 01712345678');
});

test('auto-corrects mixed case command: Ms-Nid → MS-NID', () => {
  const parsed = parseRequestText('Ms-Nid 01625242040');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requestType, 'MS-NID');
});

test('strips hyphens from identifier: 01718-000000 → 01718000000', () => {
  const parsed = parseRequestText('LRL 01718-000000');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.identifiers, ['01718000000']);
  assert.equal(parsed.canonicalRequestText, 'LRL 01718000000');
  assert.ok(parsed.correctionMessage);
});

test('strips separators from identifier: colons, underscores, commas, dots', () => {
  const parsed = parseRequestText('LRL 0171:800.00,0_0');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.identifiers, ['01718000000']);
  assert.ok(parsed.correctionMessage);
});

test('auto-corrects glued prefix with separator: LRL-01718000000 → LRL 01718000000', () => {
  const parsed = parseRequestText('LRL-01718000000');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requestType, 'LRL');
  assert.deepEqual(parsed.identifiers, ['01718000000']);
  assert.ok(parsed.correctionMessage);
});

test('auto-corrects command-separator-number with hyphens in number: LRL-01718-000000', () => {
  const parsed = parseRequestText('LRL-01718-000000');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requestType, 'LRL');
  assert.deepEqual(parsed.identifiers, ['01718000000']);
});

test('strips +880 country code: LRL +8801712345678 → LRL 01712345678', () => {
  const parsed = parseRequestText('LRL +8801712345678');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requestType, 'LRL');
  assert.deepEqual(parsed.identifiers, ['01712345678']);
  assert.equal(parsed.canonicalRequestText, 'LRL 01712345678');
  assert.ok(parsed.correctionMessage);
});

test('strips 880 country code without plus: LRL 8801712345678 → LRL 01712345678', () => {
  const parsed = parseRequestText('LRL 8801712345678');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.identifiers, ['01712345678']);
});

test('strips +880 with hyphens: LCL +880-1718-000000 → LCL 01718000000', () => {
  const parsed = parseRequestText('LCL +880-1718-000000');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.identifiers, ['01718000000']);
});

test('strips +880 in batch: MS-NID +8801625242040 8801825242040', () => {
  const parsed = parseRequestText('MS-NID +8801625242040 8801825242040');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.identifiers, ['01625242040', '01825242040']);
});

test('specific error when phone number too short', () => {
  const parsed = parseRequestText('LRL 0171234');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.errorCode, 'INVALID_IDENTIFIER_FORMAT');
  assert.match(parsed.replyText, /too short.*7 digits/);
});

test('specific error when NID given instead of phone number', () => {
  const parsed = parseRequestText('LRL 4246780000');
  assert.equal(parsed.ok, false);
  assert.match(parsed.replyText, /looks like an NID.*10 digits.*not a phone number/);
});

test('specific error when IMEI given instead of phone number', () => {
  const parsed = parseRequestText('LCL 35391109000000');
  assert.equal(parsed.ok, false);
  assert.match(parsed.replyText, /looks like an IMEI.*14 digits.*not a phone number/);
});

test('specific error when phone number given instead of NID', () => {
  const parsed = parseRequestText('NID-MS 01712345678');
  assert.equal(parsed.ok, false);
  assert.match(parsed.replyText, /looks like a phone number.*not an NID/);
});

test('specific error when phone number given instead of IMEI', () => {
  const parsed = parseRequestText('IMEI-MS 01712345678');
  assert.equal(parsed.ok, false);
  assert.match(parsed.replyText, /looks like a phone number.*not an IMEI/);
});

test('specific error when IMEI given instead of NID', () => {
  const parsed = parseRequestText('NID-MS 35391109000000');
  assert.equal(parsed.ok, false);
  assert.match(parsed.replyText, /looks like an IMEI.*14 digits.*not an NID/);
});

test('specific error when NID given instead of IMEI', () => {
  const parsed = parseRequestText('IMEI-MS 4246780000');
  assert.equal(parsed.ok, false);
  assert.match(parsed.replyText, /looks like an NID.*10 digits.*not an IMEI/);
});

test('specific error for invalid NID length (12 digits)', () => {
  const parsed = parseRequestText('NID-MS 123456789012');
  assert.equal(parsed.ok, false);
  assert.match(parsed.replyText, /12 digits.*not a valid NID length.*exactly 10, 13, or 17/);
});

test('accepts valid NID lengths: 10, 13, 17 digits', () => {
  assert.equal(parseRequestText('NID-MS 4246780000').ok, true);
  assert.equal(parseRequestText('NID-MS 1234567890123').ok, true);
  assert.equal(parseRequestText('NID-MS 12345678901234567').ok, true);
});

test('accepts valid IMEI lengths: 14 and 15 digits', () => {
  assert.equal(parseRequestText('IMEI-MS 35391109000000').ok, true);
  assert.equal(parseRequestText('IMEI-MS 353911090000001').ok, true);
});

test('identifier with letters after stripping still fails', () => {
  const parsed = parseRequestText('LRL 0171800ABC0');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.errorCode, 'INVALID_IDENTIFIER_CHARS');
});

test('submits request, sends SMS, and waits for operator reply', async () => {
  const { store, service } = createHarness();
  const result = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });

  assert.equal(result.ok, true);
  assert.equal(result.request.status, STATUSES.WAITING_OPERATOR_REPLY);
  assert.equal(store.smsOutbox.length, 1);
  assert.equal(store.smsOutbox[0].gatewayId, 'GP_PHONE_01');
  assert.equal(store.smsOutbox[0].messageBody, 'LRL 01712345678');
  assert.match(result.request.silentReference, /^SR/);
});

test('submits canonicalized request text to queue and gateway dispatch', async () => {
  const { store, service } = createHarness();
  const result = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: '  lcl \n 01712345678   01799999999 '
  });

  assert.equal(result.ok, true);
  assert.equal(result.request.payload, '01712345678 01799999999');
  assert.equal(store.smsOutbox.length, 1);
  assert.equal(store.smsOutbox[0].messageBody, 'LCL 01712345678 01799999999');
});

test('invalid request does not enter request queue and writes audit failure', async () => {
  const { store, service } = createHarness();
  const result = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LCL 01710000000 LRL 01720000001'
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'MIXED_REQUEST_TYPES');
  assert.equal(store.listRequests().length, 0);
  assert.equal(store.smsOutbox.length, 0);
  const audit = store.auditLogs.at(-1);
  assert.equal(audit.action, 'REQUEST_VALIDATION_FAILED');
  assert.equal(audit.requestId, null);
  assert.equal(audit.details.errorCode, 'MIXED_REQUEST_TYPES');
});

test('dispatches multiple same-operator requests without blocking', async () => {
  const { store, service } = createHarness();
  await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });
  await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Karim',
    requesterId: '8801800000000',
    text: 'LRL 01798765432'
  });

  assert.equal(store.smsOutbox.length, 2);
  const second = store.listRequests().find((request) => request.requesterName === 'Officer Karim');
  assert.equal(second.status, STATUSES.WAITING_OPERATOR_REPLY);
});

test('blocks duplicate active request intake and returns existing request id', async () => {
  const { store, service } = createHarness();
  const first = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });

  const duplicate = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Karim',
    requesterId: '8801800000000',
    text: 'LRL 01712345678'
  });

  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errorCode, 'DUPLICATE_ACTIVE_REQUEST');
  assert.equal(duplicate.duplicateRequestId, first.request.requestId);
  assert.equal(store.listRequests().length, 1);
  assert.equal(store.auditLogs.at(-1).action, 'REQUEST_DUPLICATE_BLOCKED');
});

test('matches operator reply and drafts a tagged reply', async () => {
  const { service } = createHarness();
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
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
  assert.match(inbound.replyDraft.replyText, /@Officer Rahim/);
  assert.match(inbound.replyDraft.replyText, /LRL: 01712345678/);
});

test('duplicate inbound webhook retry is ignored without creating a second inbox row', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });

  const receivedAt = '2026-06-20T10:15:00.000+06:00';
  const payload = {
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'LRL cell location',
    receivedAt
  };

  const first = service.receiveSmsWebhook(payload);
  const second = service.receiveSmsWebhook(payload);

  assert.equal(first.ok, true);
  assert.equal(first.request.requestId, submitted.request.requestId);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(store.smsInbox.length, 1);
  assert.equal(store.listReplyDrafts().filter((row) => row.requestId === submitted.request.requestId).length, 1);
  assert.equal(store.auditLogs.some((row) => row.action === 'SMS_INBOUND_DUPLICATE_IGNORED'), true);
});

test('single-operator batch replies include multiple matched inbound SMS messages', async () => {
  const { store, service } = createHarness({
    BANGLALINK: { trustedSenders: ['8801924400990'] }
  });
  const submitted = await service.submitRequest({
    channel: 'telegram',
    chatId: 'operations',
    sourceMessageId: 315,
    requesterName: 'LIC Barisal',
    requesterId: '8739371943',
    text: 'LRL 01937690281 01916018151'
  });

  const firstInbound = service.receiveSmsWebhook({
    gatewayId: 'BANGLALINK_PHONE_01',
    from: '8801924400990',
    body: 'MN: 8801916018151, Cell Name: DHK_X0118_1 - Banglalink',
    receivedAt: '2026-06-18T20:40:17.023287+06:00'
  });
  assert.equal(firstInbound.ok, true);

  const secondInbound = service.receiveSmsWebhook({
    gatewayId: 'BANGLALINK_PHONE_01',
    from: '8801924400990',
    body: 'MN: 8801937690281, Cell Name: BAR_X0080_2 - Banglalink',
    receivedAt: '2026-06-18T20:40:21.100395+06:00'
  });
  assert.equal(secondInbound.ok, true);

  const request = store.getRequest(submitted.request.requestId);
  const draft = store.listReplyDrafts().find((row) => row.requestId === request.requestId);
  assert.equal(request.status, STATUSES.NEEDS_MANUAL_REVIEW);
  assert.ok(draft);
  assert.match(draft.replyText, /8801916018151/);
  assert.match(draft.replyText, /8801937690281/);
});

test('manual approval completes request after reply review', async () => {
  const { service } = createHarness();
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });
  service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'LRL cell location'
  });

  const completed = await service.approveReply(submitted.request.requestId);
  assert.equal(completed.status, STATUSES.COMPLETED);
});

test('payload matching disambiguates concurrent same-operator requests', async () => {
  const { store, service } = createHarness();
  await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });
  await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Karim',
    requesterId: '8801800000000',
    text: 'LRL 01798765432'
  });

  assert.equal(store.smsOutbox.length, 2);

  // Reply contains the second request's phone number â€” should match Officer Karim's request
  const inbound = service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'LRL location data for 01798765432: LAC 1234 Cell 5678'
  });

  assert.equal(inbound.ok, true);
  assert.equal(inbound.request.requesterName, 'Officer Karim');
});

test('NID-MS request is sent to all operator gateways', async () => {
  const { store, service } = createHarness();
  const result = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'NID-MS 1234567890123'
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
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'NID-MS 1234567890123'
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
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'NID-MS 1234567890123'
  });
  service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'NID 1234567890'
  });

  await assert.rejects(
    () => service.approveReply(submitted.request.requestId),
    /not ready for reply approval/
  );
});

test('ignores junk SMS from untrusted sender before analysis', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
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

test('SMS job is queued as PENDING_PICKUP for phone to poll', async () => {
  const { store, service } = createHarness({
    GP: { gatewayUrl: 'http://phone-gp.local:8080', trustedSenders: ['12345'] }
  });
  await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });
  const jobs = store.claimPendingJobs('GP_PHONE_01');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].destinationNumber, store.getGatewayByOperator('GP').shortcode);
  assert.match(jobs[0].messageBody, /01712345678/);
});

test('requester authorization is preserved and enforced', async () => {
  const { store, service } = createHarness();
  store.upsertUser({
    telegramId: '8801700000000',
    displayName: 'Officer Rahim',
    allowedOperators: ['ROBI']
  });

  const blocked = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
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
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
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
  await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });
  await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Karim',
    requesterId: '8801800000000',
    text: 'LRL 01798765432'
  });

  store.claimPendingJobs('GP_PHONE_01');
  store.ackOutboxJob(store.smsOutbox[0].id, { ok: true, providerMessageId: 'sms_1' });
  store.smsOutbox[0].sendResult.confirmedAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();

  const timedOut = await service.timeoutWaitingRequests();
  assert.equal(timedOut.length, 1);
  assert.equal(timedOut[0].status, STATUSES.TIMEOUT);
  assert.equal(store.smsOutbox.length, 2);
  assert.equal(store.smsOutbox[1].messageBody, 'LRL 01798765432');
});

test('late-claimed job gets a full reply window from claim time, not queue time', async () => {
  const { store, service } = createHarness();
  await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });

  // Simulate a gateway phone that was offline: the job sat PENDING_PICKUP for 9 minutes
  // (older than the reply window on its own) before the phone reconnected and claimed it.
  const outbox = store.smsOutbox[0];
  outbox.sentAt = new Date(Date.now() - 9 * 60 * 1000).toISOString();
  store.claimPendingJobs(outbox.gatewayId);

  const timedOut = await service.timeoutWaitingRequests();
  assert.equal(timedOut.length, 0, 'should not time out — the reply window starts from the recent claim, not the stale queue time');
});

test('request does not time out early while gateway send confirmation is still pending', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });

  store.smsOutbox[0].sentAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const beforeGrace = await service.timeoutWaitingRequests();
  assert.equal(beforeGrace.length, 0);
  assert.equal(store.getRequest(submitted.request.requestId).status, STATUSES.WAITING_OPERATOR_REPLY);

  store.smsOutbox[0].sentAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  const afterGrace = await service.timeoutWaitingRequests();
  assert.equal(afterGrace.length, 1);
  assert.equal(store.getRequest(submitted.request.requestId).status, STATUSES.TIMEOUT);
});

test('request IDs stay unique across store restarts', () => {
  const first = new AutomationStore();
  const second = new AutomationStore();
  const id1 = first.nextRequestId();
  const id2 = second.nextRequestId();
  assert.notEqual(id1, id2);
});

test('phone polling claims job and ack updates outbox status', async () => {
  const { store, service } = createHarness({
    GP: { trustedSenders: ['12345'] }
  });
  await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });

  // Simulate phone poll
  const jobs = store.claimPendingJobs('GP_PHONE_01');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].sentStatus, 'CLAIMED');

  // Simulate phone ack
  const acked = store.ackOutboxJob(jobs[0].id, { ok: true, providerMessageId: 'sms_123' });
  assert.equal(acked.sentStatus, 'SENT');
  assert.equal(acked.sendResult.mode, 'poll');
});

test('fan-out with two replies and one timeout finalizes to manual review (not timeout)', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'NID-MS 1234567890123'
  });
  const requestId = submitted.request.requestId;

  // GP and ROBI reply; Banglalink stays silent.
  service.receiveSmsWebhook({ gatewayId: 'GP_PHONE_01', from: '12345', body: 'NID 111 GP' });
  service.receiveSmsWebhook({ gatewayId: 'ROBI_PHONE_01', from: '12345', body: 'NID 222 ROBI' });
  assert.equal(store.getRequest(requestId).status, STATUSES.WAITING_OPERATOR_REPLY);

  // Age the Banglalink send past the reply window so only ITS dispatch times out.
  const blOutbox = store.smsOutbox.find((row) => row.gatewayId === 'BANGLALINK_PHONE_01');
  store.claimPendingJobs('BANGLALINK_PHONE_01');
  store.ackOutboxJob(blOutbox.id, { ok: true, providerMessageId: 'sms_bl' });
  blOutbox.sendResult.confirmedAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();

  const finalized = await service.timeoutWaitingRequests();
  const request = store.getRequest(requestId);

  // Derived status: at least one reply arrived, so the request is reviewable â€” NOT a blanket timeout.
  assert.equal(request.status, STATUSES.NEEDS_MANUAL_REVIEW);
  assert.equal(finalized.length, 1);

  const dispatchStatus = (op) => request.dispatches.find((d) => d.operator === op).status;
  assert.equal(dispatchStatus('GP'), 'REPLY_RECEIVED');
  assert.equal(dispatchStatus('ROBI'), 'REPLY_RECEIVED');
  assert.equal(dispatchStatus('BANGLALINK'), 'TIMEOUT');

  // One combined draft with per-operator sections (replies + the timed-out operator marked).
  const drafts = store.listReplyDrafts().filter((r) => r.requestId === requestId);
  assert.equal(drafts.length, 1);
  assert.match(drafts[0].replyText, /GP:/);
  assert.match(drafts[0].replyText, /NID 111 GP/);
  assert.match(drafts[0].replyText, /Banglalink: no reply \(timed out\)/);
});

test('fan-out with no replies times out as a whole', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'NID-MS 1234567890123'
  });
  for (const row of store.smsOutbox) {
    store.claimPendingJobs(row.gatewayId);
    store.ackOutboxJob(row.id, { ok: true, providerMessageId: `sms_${row.id}` });
    row.sendResult.confirmedAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  }
  const finalized = await service.timeoutWaitingRequests();
  assert.equal(finalized.length, 1);
  assert.equal(store.getRequest(submitted.request.requestId).status, STATUSES.TIMEOUT);
});

test('telegram-channel request carries chat + source message metadata to the draft', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitRequest({
    channel: 'telegram',
    chatId: '-1001234567890',
    sourceMessageId: 42,
    requesterName: 'Officer Rahim',
    requesterId: '777888999',
    text: 'LRL 01712345678'
  });

  assert.equal(submitted.request.channel, 'telegram');
  assert.equal(submitted.request.chatId, '-1001234567890');
  assert.equal(submitted.request.sourceMessageId, 42);

  service.receiveSmsWebhook({ gatewayId: 'GP_PHONE_01', from: '12345', body: 'LRL cell location' });

  const draft = store.listReplyDrafts({ status: 'DRAFT' }).at(-1);
  assert.equal(draft.channel, 'telegram');
  assert.equal(draft.chatId, '-1001234567890');
  assert.equal(draft.sourceMessageId, 42);
  assert.equal(draft.requesterId, '777888999');
});

test('automated-channel approval defers posting and bridge confirmation completes it', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitRequest({
    channel: 'telegram',
    chatId: '-1001234567890',
    sourceMessageId: 42,
    requesterName: 'Officer Rahim',
    requesterId: '777888999',
    text: 'LRL 01712345678'
  });
  service.receiveSmsWebhook({ gatewayId: 'GP_PHONE_01', from: '12345', body: 'LRL cell location' });

  // Approval does NOT complete the request for automated channels â€” it queues for the bridge.
  await service.approveReply(submitted.request.requestId);
  assert.equal(store.getRequest(submitted.request.requestId).status, STATUSES.NEEDS_MANUAL_REVIEW);
  const queued = store.listReplyDrafts({ status: 'APPROVED_FOR_POST' });
  assert.equal(queued.length, 1);

  // Bridge confirms it posted â†’ request completes.
  const completed = await service.markReplyPosted(queued[0].id, { postedMessageId: 100 });
  assert.equal(completed.status, STATUSES.COMPLETED);
  assert.equal(store.getReplyDraft(queued[0].id).sentStatus, 'POSTED');
  assert.equal(store.getReplyDraft(queued[0].id).postedMessageId, 100);
});

test('manual-channel approval still completes in one step', async () => {
  const { service } = createHarness();
  const submitted = await service.submitRequest({
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });
  service.receiveSmsWebhook({ gatewayId: 'GP_PHONE_01', from: '12345', body: 'LRL cell location' });

  const completed = await service.approveReply(submitted.request.requestId);
  assert.equal(completed.status, STATUSES.COMPLETED);
});

test('disambiguates multiple pending requests by reply content analysis', async () => {
  // Force two requests onto the same GP gateway simultaneously by manually creating them
  // (normally the queue blocks the second, but we need to test the matching logic).
  const { store, service } = createHarness();

  // Create two requests on the GP gateway, both WAITING_OPERATOR_REPLY.
  const req1Input = {
    chatId: 'operations',
    requesterId: '8801700000000',
    requesterName: 'Officer Rahim',
    operator: 'GP',
    targetOperators: ['GP'],
    requestType: 'LRL',
    payload: '01712345678',
    rawRequestText: 'LRL 01712345678'
  };
  const req2Input = {
    chatId: 'operations',
    requesterId: '8801800000000',
    requesterName: 'Officer Karim',
    operator: 'GP',
    targetOperators: ['GP'],
    requestType: 'MS-NID',
    payload: '01712345678',
    rawRequestText: 'MS-NID 01712345678'
  };

  const req1 = store.createRequest(req1Input);
  store.updateRequestStatus(req1.requestId, STATUSES.VALIDATED);
  store.updateRequestStatus(req1.requestId, STATUSES.QUEUED);
  store.updateRequestStatus(req1.requestId, STATUSES.SMS_SENT);
  store.updateRequestStatus(req1.requestId, STATUSES.WAITING_OPERATOR_REPLY);
  store.addSmsOutbox({
    requestId: req1.requestId, gatewayId: 'GP_PHONE_01', operator: 'GP',
    silentReference: req1.silentReference, destinationNumber: '12345',
    messageBody: 'LRL 01712345678', sentStatus: 'SENT'
  });
  store.setDispatchSent(req1.requestId, 'GP', { ok: true });

  const req2 = store.createRequest(req2Input);
  store.updateRequestStatus(req2.requestId, STATUSES.VALIDATED);
  store.updateRequestStatus(req2.requestId, STATUSES.QUEUED);
  store.updateRequestStatus(req2.requestId, STATUSES.SMS_SENT);
  store.updateRequestStatus(req2.requestId, STATUSES.WAITING_OPERATOR_REPLY);
  store.addSmsOutbox({
    requestId: req2.requestId, gatewayId: 'GP_PHONE_01', operator: 'GP',
    silentReference: req2.silentReference, destinationNumber: '12345',
    messageBody: 'MS-NID 01712345678', sentStatus: 'SENT'
  });
  store.setDispatchSent(req2.requestId, 'GP', { ok: true });

  // Reply with NID content â€” should match the MS-NID request, not LRL.
  const result = service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'NID: 1234567890, Name: Test Person, Father: Test Father'
  });

  assert.equal(result.ok, true);
  assert.equal(result.request.requestId, req2.requestId);
});

test('ambiguous requests with equal scores fall to manual review', async () => {
  const { store, service } = createHarness();

  // Two LRL requests with the same type â€” reply analysis can't differentiate.
  const req1 = store.createRequest({
    chatId: 'ops', requesterId: '111', requesterName: 'A',
    operator: 'GP', targetOperators: ['GP'], requestType: 'LRL',
    payload: '01712345678', rawRequestText: 'LRL 01712345678'
  });
  store.updateRequestStatus(req1.requestId, STATUSES.VALIDATED);
  store.updateRequestStatus(req1.requestId, STATUSES.QUEUED);
  store.updateRequestStatus(req1.requestId, STATUSES.SMS_SENT);
  store.updateRequestStatus(req1.requestId, STATUSES.WAITING_OPERATOR_REPLY);
  store.addSmsOutbox({
    requestId: req1.requestId, gatewayId: 'GP_PHONE_01', operator: 'GP',
    silentReference: req1.silentReference, destinationNumber: '12345',
    messageBody: 'LRL 01712345678', sentStatus: 'SENT'
  });
  store.setDispatchSent(req1.requestId, 'GP', { ok: true });

  const req2 = store.createRequest({
    chatId: 'ops', requesterId: '222', requesterName: 'B',
    operator: 'GP', targetOperators: ['GP'], requestType: 'LRL',
    payload: '01798765432', rawRequestText: 'LRL 01798765432'
  });
  store.updateRequestStatus(req2.requestId, STATUSES.VALIDATED);
  store.updateRequestStatus(req2.requestId, STATUSES.QUEUED);
  store.updateRequestStatus(req2.requestId, STATUSES.SMS_SENT);
  store.updateRequestStatus(req2.requestId, STATUSES.WAITING_OPERATOR_REPLY);
  store.addSmsOutbox({
    requestId: req2.requestId, gatewayId: 'GP_PHONE_01', operator: 'GP',
    silentReference: req2.silentReference, destinationNumber: '12345',
    messageBody: 'LRL 01798765432', sentStatus: 'SENT'
  });
  store.setDispatchSent(req2.requestId, 'GP', { ok: true });

  // Reply matches both equally â€” should go to manual review (unmatched).
  const result = service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'LRL cell location lat 23.7 lon 90.4'
  });

  assert.equal(result.ok, false);
  assert.equal(result.needsManualReview, true);
});

test('single pending request is not matched when reply strongly indicates a different request family', async () => {
  const { store, service } = createHarness({
    BANGLALINK: { trustedSenders: ['8801924400990'] }
  });
  const submitted = await service.submitRequest({
    channel: 'telegram',
    chatId: 'operations',
    sourceMessageId: 500,
    requesterName: 'LIC Barisal',
    requesterId: '8739371943',
    text: 'MS-NID 01994428200'
  });

  const inbound = service.receiveSmsWebhook({
    gatewayId: 'BANGLALINK_PHONE_01',
    from: '8801924400990',
    body: 'IMEI 353213353376890 No Data Available within 90 Days - Banglalink'
  });

  assert.equal(inbound.ok, false);
  assert.equal(inbound.needsManualReview, true);
  assert.equal(store.smsInbox.at(-1).matchedRequestId, null);

  const mismatchAudit = store.auditLogs.find((row) => row.action === 'SMS_REPLY_TYPE_MISMATCH');
  assert.ok(mismatchAudit);
  assert.equal(mismatchAudit.requestId, null);
  assert.equal(mismatchAudit.details.requestId, submitted.request.requestId);
  assert.equal(mismatchAudit.details.requestType, 'MS-NID');
});

test('ambiguous mixed-family requests prefer the candidate whose family matches the operator reply', async () => {
  const { store, service } = createHarness({
    BANGLALINK: { trustedSenders: ['8801924400990'] }
  });

  const lrl = store.createRequest({
    chatId: 'ops',
    requesterId: '111',
    requesterName: 'OC Banaripara',
    operator: 'BANGLALINK',
    targetOperators: ['BANGLALINK'],
    requestType: 'LRL',
    payload: '01971029492',
    rawRequestText: 'LRL 01971029492'
  });
  store.updateRequestStatus(lrl.requestId, STATUSES.VALIDATED);
  store.updateRequestStatus(lrl.requestId, STATUSES.QUEUED);
  store.updateRequestStatus(lrl.requestId, STATUSES.SMS_SENT);
  store.updateRequestStatus(lrl.requestId, STATUSES.WAITING_OPERATOR_REPLY);
  store.addSmsOutbox({
    requestId: lrl.requestId,
    gatewayId: 'BANGLALINK_PHONE_01',
    operator: 'BANGLALINK',
    silentReference: lrl.silentReference,
    destinationNumber: '8801924400990',
    messageBody: 'LRL 01971029492',
    sentStatus: 'SENT'
  });
  store.setDispatchSent(lrl.requestId, 'BANGLALINK', { ok: true });

  const lcl = store.createRequest({
    chatId: 'ops',
    requesterId: '222',
    requesterName: 'Different Officer',
    operator: 'BANGLALINK',
    targetOperators: ['BANGLALINK'],
    requestType: 'LCL',
    payload: '01971029492',
    rawRequestText: 'LCL 01971029492'
  });
  store.updateRequestStatus(lcl.requestId, STATUSES.VALIDATED);
  store.updateRequestStatus(lcl.requestId, STATUSES.QUEUED);
  store.updateRequestStatus(lcl.requestId, STATUSES.SMS_SENT);
  store.updateRequestStatus(lcl.requestId, STATUSES.WAITING_OPERATOR_REPLY);
  store.addSmsOutbox({
    requestId: lcl.requestId,
    gatewayId: 'BANGLALINK_PHONE_01',
    operator: 'BANGLALINK',
    silentReference: lcl.silentReference,
    destinationNumber: '8801924400990',
    messageBody: 'LCL 01971029492',
    sentStatus: 'SENT'
  });
  store.setDispatchSent(lcl.requestId, 'BANGLALINK', { ok: true });

  const result = service.receiveSmsWebhook({
    gatewayId: 'BANGLALINK_PHONE_01',
    from: '8801924400990',
    body: 'MSISDN: 8801971029492, Datetime: 20260618220704, LAC ID: 680, Cell ID: 62163, Address: Darogar Bazar, Guthia, Wazirpur, Barisal., BPARTY: 880711740273257, IMEI: 352640113845900, IMSI: 470039222076875, UsageType: MOC, NetworkType: 2G. - Banglalink'
  });

  assert.equal(result.ok, true);
  assert.equal(result.request.requestId, lcl.requestId);
  assert.equal(store.getRequest(lcl.requestId).status, STATUSES.NEEDS_MANUAL_REVIEW);
  assert.equal(store.getRequest(lrl.requestId).status, STATUSES.WAITING_OPERATOR_REPLY);
});

test('reject moves request to FAILED and frees the operator queue', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });
  service.receiveSmsWebhook({ gatewayId: 'GP_PHONE_01', from: '12345', body: 'LRL cell location' });

  // Queue a second request while the first is in review.
  await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Karim',
    requesterId: '8801800000000',
    text: 'LRL 01798765432'
  });

  const rejected = await service.rejectRequest(submitted.request.requestId, { reason: 'Bad data' });
  assert.equal(rejected.status, STATUSES.FAILED);
  assert.equal(rejected.failedReason, 'Bad data');
  // The second queued request should now be dispatched.
  assert.equal(store.smsOutbox.length, 2);
});

test('retry re-queues a failed request and dispatches it', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });
  service.receiveSmsWebhook({ gatewayId: 'GP_PHONE_01', from: '12345', body: 'LRL cell location' });
  await service.rejectRequest(submitted.request.requestId, { reason: 'Wrong reply' });
  assert.equal(store.getRequest(submitted.request.requestId).status, STATUSES.FAILED);

  const retried = await service.retryRequest(submitted.request.requestId);
  assert.equal(retried.status, STATUSES.WAITING_OPERATOR_REPLY);
  // A new outbox entry was created for the retry.
  const gpOutbox = store.smsOutbox.filter((r) => r.gatewayId === 'GP_PHONE_01');
  assert.equal(gpOutbox.length, 2);
});

test('retry re-queues a timed-out request', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });
  store.claimPendingJobs('GP_PHONE_01');
  store.ackOutboxJob(store.smsOutbox[0].id, { ok: true, providerMessageId: 'sms_retry' });
  store.smsOutbox[0].sendResult.confirmedAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  await service.timeoutWaitingRequests();
  assert.equal(store.getRequest(submitted.request.requestId).status, STATUSES.TIMEOUT);

  const retried = await service.retryRequest(submitted.request.requestId);
  assert.equal(retried.status, STATUSES.WAITING_OPERATOR_REPLY);
});

test('manual match links an unmatched inbox to a waiting request', async () => {
  const { store, service } = createHarness();
  const submitted = await service.submitRequest({
    chatId: 'operations',
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });

  // Simulate an inbound SMS that didn't auto-match (unmatched).
  const inbox = store.addSmsInbox({
    gatewayId: 'GP_PHONE_01',
    senderNumber: '12345',
    messageBody: 'LRL cell lat 23.7 lon 90.4',
    matchedRequestId: null,
    receivedAt: new Date().toISOString()
  });

  const result = service.manualMatch(inbox.id, submitted.request.requestId);
  assert.equal(result.ok, true);
  assert.equal(result.request.status, STATUSES.NEEDS_MANUAL_REVIEW);
  assert.ok(result.replyDraft);
});

test('notifyTimeouts sends a Telegram message for timed-out requests', async () => {
  const { notifyTimeouts, buildMention } = require('../telegram-bridge/bridge');
  const sent = [];
  const telegram = {
    sendThreadedReply: async (opts) => { sent.push(opts); return { message_id: 999 }; }
  };
  const backend = {
    listRecentRequests: async () => [
      {
        requestId: 'REQ-001', channel: 'telegram', status: 'TIMEOUT',
        chatId: '-100', sourceMessageId: 42, requesterName: 'Rahim',
        requesterId: '111', requestType: 'LRL', payload: '017xxx',
        failedReason: 'Operator reply timed out.'
      },
      {
        requestId: 'REQ-002', channel: 'manual', status: 'TIMEOUT',
        chatId: null, sourceMessageId: null, requesterName: 'Karim',
        requesterId: '222', requestType: 'LRL', payload: '018xxx'
      }
    ]
  };
  const notifiedSet = new Set();
  const posted = await notifyTimeouts({ backend, telegram, notifiedSet });
  // Only the telegram-channel request should be notified.
  assert.equal(posted.length, 1);
  assert.equal(posted[0], 'REQ-001');
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /timed out/);
  assert.equal(sent[0].replyToMessageId, 42);

  // Second call should not re-notify.
  const posted2 = await notifyTimeouts({ backend, telegram, notifiedSet });
  assert.equal(posted2.length, 0);
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
