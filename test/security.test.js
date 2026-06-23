'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApp } = require('../src/app');
const { AutomationStore } = require('../src/store');

function mockReq({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from([payload]);
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

function mockRes() {
  return {
    statusCode: null,
    body: '',
    writeHead(code) {
      this.statusCode = code;
    },
    end(b) {
      this.body = b || '';
    }
  };
}

async function call(app, opts) {
  const res = mockRes();
  await app.handle(mockReq(opts), res);
  let json;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = null;
  }
  return { status: res.statusCode, json, raw: res.body };
}

function appWith(authConfig, gatewayConfig) {
  return createApp({
    dbPath: '',
    authConfig: { adminApiKey: '', requireGatewayAuth: false, denyUnknownRequesters: false, ...authConfig },
    gatewayConfig: gatewayConfig || { GP: { secret: 'gp-secret', trustedSenders: ['12345'] } }
  });
}

test('admin endpoints reject without the API key and accept with it', async () => {
  const app = appWith({ adminApiKey: 'topsecret' });

  const denied = await call(app, { method: 'GET', url: '/api/dashboard' });
  assert.equal(denied.status, 401);

  const ok = await call(app, { method: 'GET', url: '/api/dashboard', headers: { 'x-api-key': 'topsecret' } });
  assert.equal(ok.status, 200);

  const bearer = await call(app, {
    method: 'GET',
    url: '/api/dashboard',
    headers: { authorization: 'Bearer topsecret' }
  });
  assert.equal(bearer.status, 200);
});

test('inbound SMS webhook requires the gateway secret', async () => {
  const app = appWith({ adminApiKey: 'topsecret' });

  // Seed a pending request via admin so the inbound can match.
  await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { requesterId: '8801700000000', requesterName: 'Ofc', text: 'LRL 01712345678' }
  });

  const unsigned = await call(app, {
    method: 'POST',
    url: '/api/sms/inbound',
    headers: { 'content-type': 'application/json' },
    body: { gatewayId: 'GP_PHONE_01', from: '12345', body: 'LRL loc' }
  });
  assert.equal(unsigned.status, 401);

  const signed = await call(app, {
    method: 'POST',
    url: '/api/sms/inbound',
    headers: { 'content-type': 'application/json', 'x-gateway-secret': 'gp-secret' },
    body: { gatewayId: 'GP_PHONE_01', from: '12345', body: 'LRL loc' }
  });
  assert.equal(signed.status, 200);
  assert.equal(signed.json.ok, true);
});

test('submitting a request requires admin or a valid gateway secret', async () => {
  const app = appWith({ adminApiKey: 'topsecret' });
  const denied = await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'content-type': 'application/json' },
    body: { requesterId: '880170', requesterName: 'X', text: 'LRL 01712345678' }
  });
  assert.equal(denied.status, 401);
});

test('dashboard snapshot never leaks gateway secret or apiKey', async () => {
  const app = appWith({ adminApiKey: 'topsecret' }, { GP: { secret: 's', apiKey: 'k', trustedSenders: ['12345'] } });
  const res = await call(app, { method: 'GET', url: '/api/dashboard', headers: { 'x-api-key': 'topsecret' } });
  const gp = res.json.gateways.find((g) => g.id === 'GP_PHONE_01');
  assert.ok(gp);
  assert.equal(gp.secret, undefined);
  assert.equal(gp.apiKey, undefined);
});

test('/api/ops/activity requires admin auth and, even authenticated, never includes raw SMS content', async () => {
  const app = appWith({ adminApiKey: 'topsecret' });

  // Seed a request and a matched reply containing real-looking sensitive identifiers —
  // MSISDN, IMEI, IMSI, and a physical address — the kind of content an operator's SMS
  // reply actually carries.
  await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { requesterId: '8801700000000', requesterName: 'Ofc', text: 'LCL 01974377632' }
  });
  const sensitiveBody = 'MSISDN: 8801974377632, BPARTY: 8801924400990, IMEI: 359127130347820, '
    + 'IMSI: 470039953682678, Address: Vill - Terochar, P.O. - Muladi, District - Barishal.';
  await call(app, {
    method: 'POST',
    url: '/api/sms/inbound',
    headers: { 'content-type': 'application/json', 'x-gateway-secret': 'gp-secret' },
    body: { gatewayId: 'GP_PHONE_01', from: '12345', body: sensitiveBody }
  });

  // The watchdog audit event stores the recipient phone number in the `requestId`
  // slot (see src/app.js's /api/gateway/watchdog handler) — a real past instance of
  // sensitive data leaking through a field that looks generic/safe.
  await call(app, {
    method: 'POST',
    url: '/api/gateway/watchdog',
    headers: { 'content-type': 'application/json', 'x-gateway-secret': 'gp-secret' },
    body: { gatewayId: 'GP_PHONE_01', recipient: '+8801833122144', messageSnippet: 'IMEI-MS 359127130347820' }
  });

  // No admin key — must be rejected outright now (the page itself requires login
  // before it ever calls this endpoint).
  const denied = await call(app, { method: 'GET', url: '/api/ops/activity' });
  assert.equal(denied.status, 401);

  // Authenticated call — sanitization is still verified as defense in depth, even
  // though auth is now the primary boundary.
  const res = await call(app, { method: 'GET', url: '/api/ops/activity', headers: { 'x-api-key': 'topsecret' } });
  assert.equal(res.status, 200);

  const raw = res.raw;
  assert.doesNotMatch(raw, /8801974377632/, 'MSISDN must not appear in the public feed');
  assert.doesNotMatch(raw, /8801924400990/, 'B-party number must not appear in the public feed');
  assert.doesNotMatch(raw, /359127130347820/, 'IMEI must not appear in the public feed');
  assert.doesNotMatch(raw, /470039953682678/, 'IMSI must not appear in the public feed');
  assert.doesNotMatch(raw, /Terochar/, 'address must not appear in the public feed');
  assert.doesNotMatch(raw, /8801833122144/, 'watchdog-reported recipient number must not appear either');

  // Stronger guarantee: no event on the public feed carries a summary or meta field
  // at all, regardless of type — those are exactly the fields that have leaked.
  for (const event of res.json.activity) {
    assert.equal(event.summary, undefined, `event ${event.id} (${event.type}) must not have a summary field`);
    assert.equal(event.meta, undefined, `event ${event.id} (${event.type}) must not have a meta field`);
  }

  // Confirm the SAME data legitimately appears for an admin-authenticated caller —
  // this is about scoping exposure to auth, not deleting the data.
  const adminRes = await call(app, { method: 'GET', url: '/api/admin/overview', headers: { 'x-api-key': 'topsecret' } });
  assert.match(adminRes.raw, /8801974377632/, 'admin view should still show full content');
});

test('deny-by-default rejects unknown requesters and allows provisioned ones', async () => {
  // adminApiKey empty â†’ admin auth disabled, so we can exercise the deny-unknown flag directly.
  const app = appWith({ denyUnknownRequesters: true });

  const unknown = await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'content-type': 'application/json' },
    body: { requesterId: '999', requesterName: 'Stranger', text: 'LRL 01712345678' }
  });
  assert.equal(unknown.status, 400);
  assert.match(unknown.json.replyText, /not an authorized requester/i);

  // Admin provisions the user, then the same request succeeds.
  await call(app, {
    method: 'POST',
    url: '/api/users',
    headers: { 'content-type': 'application/json' },
    body: { telegramId: '999', displayName: 'Now Allowed' }
  });
  const allowed = await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'content-type': 'application/json' },
    body: { requesterId: '999', requesterName: 'Now Allowed', text: 'LRL 01712345678' }
  });
  assert.equal(allowed.status, 201);
  assert.equal(allowed.json.ok, true);
});

test('disabled users are rejected even when deny-unknown is off', async () => {
  const app = appWith({});
  await call(app, {
    method: 'POST',
    url: '/api/users',
    headers: { 'content-type': 'application/json' },
    body: { telegramId: '555', displayName: 'Bad Actor', status: 'DISABLED' }
  });
  const blocked = await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'content-type': 'application/json' },
    body: { requesterId: '555', requesterName: 'Bad Actor', text: 'LRL 01712345678' }
  });
  assert.equal(blocked.status, 400);
  assert.match(blocked.json.replyText, /disabled/i);
});

test('strict gateway mode rejects gateways with no configured secret', async () => {
  // Strict mode in production always pairs with an admin key (else dev-mode admin bypasses auth).
  const app = appWith({ adminApiKey: 'topsecret', requireGatewayAuth: true }, { GP: { trustedSenders: ['12345'] } });
  const res = await call(app, {
    method: 'POST',
    url: '/api/sms/inbound',
    headers: { 'content-type': 'application/json' },
    body: { gatewayId: 'GP_PHONE_01', from: '12345', body: 'LRL loc' }
  });
  assert.equal(res.status, 401);
});

test('gateway heartbeat refreshes last-seen and online state', async () => {
  const app = appWith({ adminApiKey: 'topsecret' });
  await call(app, {
    method: 'POST',
    url: '/api/gateways/register',
    headers: { 'content-type': 'application/json', 'x-gateway-secret': 'gp-secret' },
    body: { gatewayId: 'GP_PHONE_01', host: '192.168.1.50', port: 8080 }
  });
  app.store.getGateway('GP_PHONE_01').lastSeenAt = '2000-01-01T00:00:00.000Z';

  const heartbeat = await call(app, {
    method: 'POST',
    url: '/api/gateway/heartbeat',
    headers: { 'content-type': 'application/json', 'x-gateway-secret': 'gp-secret' },
    body: { gatewayId: 'GP_PHONE_01' }
  });
  assert.equal(heartbeat.status, 200);
  assert.equal(heartbeat.json.ok, true);

  const gateways = await call(app, {
    method: 'GET',
    url: '/api/gateways',
    headers: { 'x-api-key': 'topsecret' }
  });
  const gp = gateways.json.gateways.find((gateway) => gateway.id === 'GP_PHONE_01');
  assert.equal(gp.online, true);
});

test('admin overview exposes delayed-send and duplicate-risk diagnostics', async () => {
  const app = appWith({ adminApiKey: 'topsecret' });
  const first = await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { requesterId: '880170', requesterName: 'Ofc', text: 'LRL 01712345678' }
  });
  assert.equal(first.status, 201);

  const duplicate = await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { requesterId: '880171', requesterName: 'Ofc 2', text: 'LRL 01712345678' }
  });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.json.errorCode, 'DUPLICATE_ACTIVE_REQUEST');

  app.store.smsOutbox[0].sentAt = new Date(Date.now() - (16 * 60 * 1000)).toISOString();
  const overview = await call(app, {
    method: 'GET',
    url: '/api/admin/overview',
    headers: { 'x-api-key': 'topsecret' }
  });
  assert.equal(overview.status, 200);
  assert.equal(overview.json.stats.delayedConfirmations, 1);
  assert.equal(overview.json.diagnostics.recentDuplicateBlocks, 1);
  const gpQueue = overview.json.queues.find((row) => row.operator === 'GP');
  assert.equal(gpQueue.delayedSendCount, 1);
});

test('audit chain verifies clean and detects tampering', () => {
  const store = new AutomationStore();
  store.audit('a', 'EVENT_ONE', null, { x: 1 });
  store.audit('b', 'EVENT_TWO', 'REQ-1', { y: 2 });
  store.audit('c', 'EVENT_THREE', null, { z: 3 });

  assert.deepEqual(store.verifyAuditChain().ok, true);

  // Tamper a past entry's details â€” the chain must flag it.
  store.auditLogs[1].details = { y: 999 };
  const result = store.verifyAuditChain();
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, store.auditLogs[1].id);
});

test('audit chain detects a deleted row', () => {
  const store = new AutomationStore();
  store.audit('a', 'ONE', null, {});
  store.audit('b', 'TWO', null, {});
  store.audit('c', 'THREE', null, {});
  store.auditLogs.splice(1, 1); // remove the middle row
  assert.equal(store.verifyAuditChain().ok, false);
});

test('audit export returns CSV with the hash columns', async () => {
  const app = appWith({ adminApiKey: 'topsecret' });
  await call(app, {
    method: 'POST',
    url: '/api/requests',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { requesterId: '880170', requesterName: 'Ofc', text: 'LRL 01712345678' }
  });
  const res = await call(app, { method: 'GET', url: '/api/audit/export', headers: { 'x-api-key': 'topsecret' } });
  assert.equal(res.status, 200);
  assert.match(res.raw.split('\r\n')[0], /id,timestamp,actor,action,requestId,details,prevHash,hash/);
  assert.ok(res.raw.split('\r\n').length > 1);
});

function withTempSettingsConfig(fn) {
  const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { tmpdir } = require('node:os');
  const root = mkdtempSync(join(tmpdir(), 'security-settings-'));
  const telegramPath = join(root, 'telegram.json');
  const gatewaysPath = join(root, 'gateways.json');
  writeFileSync(telegramPath, JSON.stringify({ botToken: 'tok', groupChatId: -111 }, null, 2));
  writeFileSync(gatewaysPath, JSON.stringify({ GP: { trustedSenders: ['12345'] } }, null, 2));

  const prevTelegram = process.env.SMS_TELEGRAM_CONFIG;
  const prevGateways = process.env.SMS_GATEWAYS_CONFIG;
  process.env.SMS_TELEGRAM_CONFIG = telegramPath;
  process.env.SMS_GATEWAYS_CONFIG = gatewaysPath;

  return Promise.resolve(fn()).finally(() => {
    if (prevTelegram === undefined) delete process.env.SMS_TELEGRAM_CONFIG;
    else process.env.SMS_TELEGRAM_CONFIG = prevTelegram;
    if (prevGateways === undefined) delete process.env.SMS_GATEWAYS_CONFIG;
    else process.env.SMS_GATEWAYS_CONFIG = prevGateways;
    rmSync(root, { recursive: true, force: true });
  });
}

test('admin settings endpoints require auth and round-trip the telegram group id', async () => {
  await withTempSettingsConfig(async () => {
    const app = appWith({ adminApiKey: 'topsecret' });

    const denied = await call(app, { method: 'GET', url: '/api/admin/settings' });
    assert.equal(denied.status, 401);

    const before = await call(app, { method: 'GET', url: '/api/admin/settings', headers: { 'x-api-key': 'topsecret' } });
    assert.equal(before.status, 200);
    assert.equal(before.json.telegramGroupChatId, '-111');

    const deniedWrite = await call(app, {
      method: 'POST',
      url: '/api/admin/settings/telegram-group',
      body: { groupChatId: '-1004316326579' }
    });
    assert.equal(deniedWrite.status, 401);

    const write = await call(app, {
      method: 'POST',
      url: '/api/admin/settings/telegram-group',
      headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
      body: { groupChatId: '-1004316326579' }
    });
    assert.equal(write.status, 200);
    assert.equal(write.json.groupChatId, '-1004316326579');

    const after = await call(app, { method: 'GET', url: '/api/admin/settings', headers: { 'x-api-key': 'topsecret' } });
    assert.equal(after.json.telegramGroupChatId, '-1004316326579');

    const badWrite = await call(app, {
      method: 'POST',
      url: '/api/admin/settings/telegram-group',
      headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
      body: { groupChatId: 'not-numeric' }
    });
    assert.equal(badWrite.status, 400);
  });
});

test('admin settings endpoint updates an operator shortcode and applies it live', async () => {
  await withTempSettingsConfig(async () => {
    const app = appWith({ adminApiKey: 'topsecret' }, { GP: { trustedSenders: ['12345'] } });

    const write = await call(app, {
      method: 'POST',
      url: '/api/admin/settings/operator-contact',
      headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
      body: { operator: 'gp', shortcode: '01799999999' }
    });
    assert.equal(write.status, 200);
    assert.equal(write.json.shortcode, '01799999999');

    const dashboard = await call(app, { method: 'GET', url: '/api/dashboard', headers: { 'x-api-key': 'topsecret' } });
    const gp = dashboard.json.gatewayHealth.find((g) => g.operator === 'GP');
    assert.equal(gp.shortcode, '01799999999');

    const unknownOperator = await call(app, {
      method: 'POST',
      url: '/api/admin/settings/operator-contact',
      headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
      body: { operator: 'NOT_REAL', shortcode: '01799999999' }
    });
    assert.equal(unknownOperator.status, 400);
  });
});

test('chat-mismatch endpoint requires auth and writes an audit entry', async () => {
  const app = appWith({ adminApiKey: 'topsecret' });

  const denied = await call(app, {
    method: 'POST',
    url: '/api/telegram/chat-mismatch',
    body: { chatId: '-999' }
  });
  assert.equal(denied.status, 401);

  const ok = await call(app, {
    method: 'POST',
    url: '/api/telegram/chat-mismatch',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { chatId: '-999', chatTitle: 'Wrong Group', configuredGroupChatId: '-111' }
  });
  assert.equal(ok.status, 200);

  const dashboard = await call(app, { method: 'GET', url: '/api/dashboard', headers: { 'x-api-key': 'topsecret' } });
  assert.equal(dashboard.json.stats.telegramChatMismatches24h, 1);
  assert.equal(dashboard.json.diagnostics.recentChatMismatches[0].chatId, '-999');
});

test('unauthorized-attempt endpoint requires auth and writes an audit entry', async () => {
  const app = appWith({ adminApiKey: 'topsecret' });

  const denied = await call(app, {
    method: 'POST',
    url: '/api/telegram/unauthorized-attempt',
    body: { chatId: '555', fromId: '555' }
  });
  assert.equal(denied.status, 401);

  const missingField = await call(app, {
    method: 'POST',
    url: '/api/telegram/unauthorized-attempt',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { chatId: '555' }
  });
  assert.equal(missingField.status, 400);

  const ok = await call(app, {
    method: 'POST',
    url: '/api/telegram/unauthorized-attempt',
    headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
    body: { chatId: '555', chatType: 'private', fromId: '555', fromName: 'Unknown User' }
  });
  assert.equal(ok.status, 200);

  const dashboard = await call(app, { method: 'GET', url: '/api/dashboard', headers: { 'x-api-key': 'topsecret' } });
  assert.equal(dashboard.json.stats.telegramUnauthorizedAttempts24h, 1);
  assert.equal(dashboard.json.diagnostics.recentUnauthorizedAttempts[0].fromId, '555');
  assert.equal(dashboard.json.diagnostics.recentUnauthorizedAttempts[0].chatType, 'private');
});

test('admin settings endpoints manage authorized Telegram users end to end', async () => {
  await withTempSettingsConfig(async () => {
    const app = appWith({ adminApiKey: 'topsecret' });

    const deniedAdd = await call(app, {
      method: 'POST',
      url: '/api/admin/settings/authorized-users',
      body: { telegramUserId: '777888999', name: 'Officer Rahim' }
    });
    assert.equal(deniedAdd.status, 401);

    const add = await call(app, {
      method: 'POST',
      url: '/api/admin/settings/authorized-users',
      headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
      body: { telegramUserId: '777888999', name: 'Officer Rahim' }
    });
    assert.equal(add.status, 200);
    assert.equal(add.json.telegramUserId, '777888999');
    assert.ok(add.json.note.includes('pm2 restart sms-bridge'));

    const afterAdd = await call(app, { method: 'GET', url: '/api/admin/settings', headers: { 'x-api-key': 'topsecret' } });
    assert.deepEqual(afterAdd.json.authorizedUsers, [{ telegramUserId: '777888999', name: 'Officer Rahim' }]);

    const badAdd = await call(app, {
      method: 'POST',
      url: '/api/admin/settings/authorized-users',
      headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
      body: { telegramUserId: 'not-a-number', name: 'X' }
    });
    assert.equal(badAdd.status, 400);

    const remove = await call(app, {
      method: 'POST',
      url: '/api/admin/settings/authorized-users/remove',
      headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
      body: { telegramUserId: '777888999' }
    });
    assert.equal(remove.status, 200);

    const afterRemove = await call(app, { method: 'GET', url: '/api/admin/settings', headers: { 'x-api-key': 'topsecret' } });
    assert.deepEqual(afterRemove.json.authorizedUsers, []);

    const removeUnknown = await call(app, {
      method: 'POST',
      url: '/api/admin/settings/authorized-users/remove',
      headers: { 'x-api-key': 'topsecret', 'content-type': 'application/json' },
      body: { telegramUserId: '777888999' }
    });
    assert.equal(removeUnknown.status, 400);
  });
});
