'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createHmac } = require('node:crypto');
const { verifyTelegramAuthPayload, PortalSessionStore } = require('../src/telegramLoginAuth');

const BOT_TOKEN = '123456:ABC-test-bot-token';

// Mirrors what Telegram itself does when signing a widget payload -- used
// here only to construct fixtures for verifyTelegramAuthPayload to check.
function signPayload(fields, botToken = BOT_TOKEN) {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secretKey = createHash('sha256').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return { ...fields, hash };
}

function freshFields(overrides = {}) {
  return {
    id: 987654321,
    first_name: 'Rahim',
    username: 'rahim_officer',
    auth_date: Math.floor(Date.now() / 1000),
    ...overrides
  };
}

test('verifyTelegramAuthPayload accepts a correctly signed, fresh payload', () => {
  const payload = signPayload(freshFields());
  assert.equal(verifyTelegramAuthPayload(payload, BOT_TOKEN), true);
});

test('verifyTelegramAuthPayload rejects a tampered field (hash no longer matches)', () => {
  const payload = signPayload(freshFields());
  payload.first_name = 'Someone Else';
  assert.equal(verifyTelegramAuthPayload(payload, BOT_TOKEN), false);
});

test('verifyTelegramAuthPayload rejects a payload signed with a different bot token', () => {
  const payload = signPayload(freshFields(), 'wrong-token');
  assert.equal(verifyTelegramAuthPayload(payload, BOT_TOKEN), false);
});

test('verifyTelegramAuthPayload rejects a stale auth_date beyond the replay window', () => {
  const payload = signPayload(freshFields({ auth_date: Math.floor(Date.now() / 1000) - 25 * 60 * 60 }));
  assert.equal(verifyTelegramAuthPayload(payload, BOT_TOKEN), false);
});

test('verifyTelegramAuthPayload rejects a missing hash', () => {
  const payload = freshFields();
  assert.equal(verifyTelegramAuthPayload(payload, BOT_TOKEN), false);
});

test('verifyTelegramAuthPayload rejects when no bot token is configured', () => {
  const payload = signPayload(freshFields());
  assert.equal(verifyTelegramAuthPayload(payload, ''), false);
});

test('PortalSessionStore.create issues a token that get() resolves back to the same user', () => {
  const store = new PortalSessionStore();
  const token = store.create({ telegramUserId: '987654321', name: 'Rahim' });
  const session = store.get(token);
  assert.equal(session.telegramUserId, '987654321');
  assert.equal(session.name, 'Rahim');
});

test('PortalSessionStore.get returns null for an unknown or missing token', () => {
  const store = new PortalSessionStore();
  assert.equal(store.get('bogus-token'), null);
  assert.equal(store.get(''), null);
});

test('PortalSessionStore.get returns null once the session has expired', () => {
  const store = new PortalSessionStore({ ttlMs: -1 });
  const token = store.create({ telegramUserId: '1', name: 'X' });
  assert.equal(store.get(token), null);
});

test('PortalSessionStore.delete invalidates the session', () => {
  const store = new PortalSessionStore();
  const token = store.create({ telegramUserId: '1', name: 'X' });
  store.delete(token);
  assert.equal(store.get(token), null);
});
