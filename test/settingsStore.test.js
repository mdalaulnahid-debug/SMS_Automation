'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

function withTempConfigDir(fn) {
  const root = mkdtempSync(join(tmpdir(), 'settings-store-'));
  const telegramPath = join(root, 'telegram.json');
  const gatewaysPath = join(root, 'gateways.json');
  writeFileSync(telegramPath, JSON.stringify({ botToken: 'tok', groupChatId: -111, adminApiKey: 'k' }, null, 2));
  writeFileSync(gatewaysPath, JSON.stringify({
    GP: { gatewayUrl: '', trustedSenders: ['12345'] }
  }, null, 2));

  const prevTelegram = process.env.SMS_TELEGRAM_CONFIG;
  const prevGateways = process.env.SMS_GATEWAYS_CONFIG;
  process.env.SMS_TELEGRAM_CONFIG = telegramPath;
  process.env.SMS_GATEWAYS_CONFIG = gatewaysPath;

  // Re-require so the module picks up the freshly-set env vars cleanly per test.
  delete require.cache[require.resolve('../src/settingsStore')];
  const settingsStore = require('../src/settingsStore');

  try {
    fn(settingsStore, { telegramPath, gatewaysPath });
  } finally {
    if (prevTelegram === undefined) delete process.env.SMS_TELEGRAM_CONFIG;
    else process.env.SMS_TELEGRAM_CONFIG = prevTelegram;
    if (prevGateways === undefined) delete process.env.SMS_GATEWAYS_CONFIG;
    else process.env.SMS_GATEWAYS_CONFIG = prevGateways;
    rmSync(root, { recursive: true, force: true });
  }
}

test('readTelegramGroupChatId reads the current value', () => {
  withTempConfigDir((settingsStore) => {
    assert.equal(settingsStore.readTelegramGroupChatId(), '-111');
  });
});

test('writeTelegramGroupChatId persists and preserves other fields', () => {
  withTempConfigDir((settingsStore, { telegramPath }) => {
    const written = settingsStore.writeTelegramGroupChatId('-1004316326579');
    assert.equal(written, '-1004316326579');

    const onDisk = JSON.parse(readFileSync(telegramPath, 'utf8'));
    assert.equal(onDisk.groupChatId, '-1004316326579');
    assert.equal(onDisk.botToken, 'tok');
    assert.equal(onDisk.adminApiKey, 'k');

    assert.equal(settingsStore.readTelegramGroupChatId(), '-1004316326579');
  });
});

test('writeTelegramGroupChatId rejects non-numeric input', () => {
  withTempConfigDir((settingsStore) => {
    assert.throws(() => settingsStore.writeTelegramGroupChatId('not-a-chat-id'), /numeric/);
    assert.throws(() => settingsStore.writeTelegramGroupChatId(''), /required/);
  });
});

test('readOperatorContacts defaults to empty shortcode when unset', () => {
  withTempConfigDir((settingsStore) => {
    const contacts = settingsStore.readOperatorContacts();
    assert.equal(contacts.GP.shortcode, '');
  });
});

test('writeOperatorShortcode persists and preserves other gateway fields', () => {
  withTempConfigDir((settingsStore, { gatewaysPath }) => {
    const written = settingsStore.writeOperatorShortcode('gp', '01799999999');
    assert.equal(written, '01799999999');

    const onDisk = JSON.parse(readFileSync(gatewaysPath, 'utf8'));
    assert.equal(onDisk.GP.shortcode, '01799999999');
    assert.deepEqual(onDisk.GP.trustedSenders, ['12345']);

    assert.equal(settingsStore.readOperatorContacts().GP.shortcode, '01799999999');
  });
});

test('writeOperatorShortcode rejects malformed input', () => {
  withTempConfigDir((settingsStore) => {
    assert.throws(() => settingsStore.writeOperatorShortcode('GP', 'abc'), /shortcode/);
    assert.throws(() => settingsStore.writeOperatorShortcode('GP', ''), /required/);
  });
});

test('readAuthorizedUsers starts empty and reflects writes', () => {
  withTempConfigDir((settingsStore, { telegramPath }) => {
    assert.deepEqual(settingsStore.readAuthorizedUsers(), []);

    const added = settingsStore.writeAuthorizedUser('777888999', 'Officer Rahim');
    assert.deepEqual(added, { telegramUserId: '777888999', name: 'Officer Rahim' });

    const users = settingsStore.readAuthorizedUsers();
    assert.deepEqual(users, [{ telegramUserId: '777888999', name: 'Officer Rahim' }]);

    const onDisk = JSON.parse(readFileSync(telegramPath, 'utf8'));
    assert.equal(onDisk.authorizedUsers['777888999'].name, 'Officer Rahim');
    assert.equal(onDisk.botToken, 'tok', 'other fields must be preserved');
  });
});

test('writeAuthorizedUser updates an existing entry and preserves other users', () => {
  withTempConfigDir((settingsStore) => {
    settingsStore.writeAuthorizedUser('111', 'Officer A');
    settingsStore.writeAuthorizedUser('222', 'Officer B');
    settingsStore.writeAuthorizedUser('111', 'Officer A Renamed');

    const users = settingsStore.readAuthorizedUsers();
    assert.equal(users.length, 2);
    assert.deepEqual(users.find((u) => u.telegramUserId === '111'), { telegramUserId: '111', name: 'Officer A Renamed' });
    assert.deepEqual(users.find((u) => u.telegramUserId === '222'), { telegramUserId: '222', name: 'Officer B' });
  });
});

test('writeAuthorizedUser rejects non-numeric id or missing name', () => {
  withTempConfigDir((settingsStore) => {
    assert.throws(() => settingsStore.writeAuthorizedUser('not-a-number', 'X'), /numeric/);
    assert.throws(() => settingsStore.writeAuthorizedUser('123', ''), /name is required/);
    assert.throws(() => settingsStore.writeAuthorizedUser('', 'X'), /telegramUserId is required/);
  });
});

test('removeAuthorizedUser deletes one entry and preserves the rest', () => {
  withTempConfigDir((settingsStore) => {
    settingsStore.writeAuthorizedUser('111', 'Officer A');
    settingsStore.writeAuthorizedUser('222', 'Officer B');

    const removedId = settingsStore.removeAuthorizedUser('111');
    assert.equal(removedId, '111');

    const users = settingsStore.readAuthorizedUsers();
    assert.deepEqual(users, [{ telegramUserId: '222', name: 'Officer B' }]);
  });
});

test('removeAuthorizedUser throws for an unknown id', () => {
  withTempConfigDir((settingsStore) => {
    assert.throws(() => settingsStore.removeAuthorizedUser('999'), /No authorized user/);
  });
});
