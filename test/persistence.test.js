'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { mkdtempSync, rmSync } = require('node:fs');
const { AutomationStore } = require('../src/store');
const { OperatorQueue } = require('../src/queue');
const { SmsGatewayClient } = require('../src/smsGateway');
const { AutomationService } = require('../src/service');
const { STATUSES } = require('../src/domain');

function harness(dbPath) {
  const store = new AutomationStore({}, dbPath ? { dbPath } : {});
  const queue = new OperatorQueue(store);
  const smsGateway = new SmsGatewayClient(store, queue);
  const service = new AutomationService({ store, queue, smsGateway });
  return { store, queue, smsGateway, service };
}

function tempDb(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sms-persist-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'automation.db');
}

test('an in-flight WAITING request survives a restart and can still match its reply', async (t) => {
  const dbPath = tempDb(t);

  // First boot: submit a request (mock gateway â†’ SENT â†’ WAITING), then "crash".
  const h1 = harness(dbPath);
  const submitted = await h1.service.submitRequest({
    channel: 'telegram',
    chatId: '-100777',
    sourceMessageId: 9,
    requesterName: 'Officer Rahim',
    requesterId: '8801700000000',
    text: 'LRL 01712345678'
  });
  const requestId = submitted.request.requestId;
  assert.equal(submitted.request.status, STATUSES.WAITING_OPERATOR_REPLY);
  h1.store.close();

  // Second boot: state is restored from disk, including channel metadata + outbox.
  const h2 = harness(dbPath);
  const restored = h2.store.getRequest(requestId);
  assert.equal(restored.status, STATUSES.WAITING_OPERATOR_REPLY);
  assert.equal(restored.channel, 'telegram');
  assert.equal(restored.sourceMessageId, '9');
  assert.equal(h2.store.smsOutbox.length, 1);

  // The restored in-flight request still matches an operator reply after restart.
  const inbound = h2.service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01',
    from: '12345',
    body: 'LRL cell location'
  });
  assert.equal(inbound.ok, true);
  assert.equal(inbound.request.requestId, requestId);
  assert.equal(inbound.request.status, STATUSES.NEEDS_MANUAL_REVIEW);
  h2.store.close();
});

test('a QUEUED request is re-dispatched after restart via recover/rebuild', async (t) => {
  const dbPath = tempDb(t);

  // Submit one request, then close before it can be fully processed.
  const h1 = harness(dbPath);
  await h1.service.submitRequest({
    requesterName: 'A', requesterId: '8801700000001', chatId: 'g', text: 'LRL 01712345678'
  });
  assert.equal(h1.store.smsOutbox.length, 1);
  assert.equal(h1.store.getRequest(h1.store.listRequests()[0].requestId).status, STATUSES.WAITING_OPERATOR_REPLY);
  h1.store.close();

  // Restart: the request should be restored in WAITING_OPERATOR_REPLY state.
  const h2 = harness(dbPath);
  h2.queue.rebuild();
  const restored = h2.store.listRequests().find((r) => r.requesterName === 'A');
  assert.equal(restored.status, STATUSES.WAITING_OPERATOR_REPLY);

  // Reply arrives and matches correctly.
  const inbound = h2.service.receiveSmsWebhook({
    gatewayId: 'GP_PHONE_01', from: '12345', body: 'LRL location for 01712345678'
  });
  assert.equal(inbound.ok, true);
  assert.equal(inbound.request.status, STATUSES.NEEDS_MANUAL_REVIEW);
  h2.store.close();
});

test('per-operator dispatches survive a restart and finalize correctly afterward', async (t) => {
  const dbPath = tempDb(t);

  // Fan-out request; GP replies before the "crash".
  const h1 = harness(dbPath);
  const submitted = await h1.service.submitRequest({
    chatId: 'g', requesterName: 'Ofc', requesterId: '8801700000000',
    text: 'NID-MS 123456789012'
  });
  const requestId = submitted.request.requestId;
  h1.service.receiveSmsWebhook({ gatewayId: 'GP_PHONE_01', from: '12345', body: 'NID 111' });
  h1.store.close();

  // Restart: dispatches restored with their individual statuses.
  const h2 = harness(dbPath);
  const restored = h2.store.getRequest(requestId);
  assert.equal(restored.dispatches.length, 3);
  assert.equal(restored.dispatches.find((d) => d.operator === 'GP').status, 'REPLY_RECEIVED');
  assert.equal(restored.dispatches.find((d) => d.operator === 'ROBI').status, 'WAITING_REPLY');

  // Remaining operators reply after restart â†’ request finalizes to manual review.
  h2.service.receiveSmsWebhook({ gatewayId: 'ROBI_PHONE_01', from: '12345', body: 'NID 222' });
  const last = h2.service.receiveSmsWebhook({ gatewayId: 'BANGLALINK_PHONE_01', from: '12345', body: 'NID 333' });
  assert.equal(last.request.status, STATUSES.NEEDS_MANUAL_REVIEW);
  h2.store.close();
});

test('request-id sequence continues monotonically across restarts', (t) => {
  const dbPath = tempDb(t);
  const h1 = harness(dbPath);
  h1.store.nextRequestId();
  h1.store.nextRequestId();
  assert.equal(h1.store.sequence, 2);
  h1.store.close();

  const h2 = harness(dbPath);
  assert.equal(h2.store.sequence, 2);
  h2.store.nextRequestId();
  assert.equal(h2.store.sequence, 3);
  h2.store.close();
});

test('audit log is durable across restarts', (t) => {
  const dbPath = tempDb(t);
  const h1 = harness(dbPath);
  const beforeCount = h1.store.auditLogs.length;
  h1.store.audit('test', 'CUSTOM_EVENT', null, { note: 'durable' });
  h1.store.close();

  const h2 = harness(dbPath);
  const restored = h2.store.auditLogs.find((row) => row.action === 'CUSTOM_EVENT');
  assert.ok(restored, 'custom audit event should survive restart');
  assert.equal(restored.details.note, 'durable');
  assert.ok(h2.store.auditLogs.length > beforeCount);
  h2.store.close();
});
