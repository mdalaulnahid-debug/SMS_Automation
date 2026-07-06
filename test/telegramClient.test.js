'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TelegramClient } = require('../telegram-bridge/telegramClient');

// Fake clock: sleepImpl resolves immediately but records requested durations, and Date.now()
// is advanced manually by the same amount — so throttle-spacing math can be asserted without
// the test suite actually waiting in real time.
function fakeClock(startAt = 1_000_000) {
  let now = startAt;
  const waits = [];
  const realDateNow = Date.now;
  Date.now = () => now;
  const sleep = async (ms) => { waits.push(ms); now += ms; };
  const restore = () => { Date.now = realDateNow; };
  return { sleep, waits, advance: (ms) => { now += ms; }, restore };
}

function fakeFetchSequence(responses) {
  let i = 0;
  return async () => {
    const resp = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return { json: async () => resp };
  };
}

test('sendMessage and sendThreadedReply space consecutive sends by minSendSpacingMs', async () => {
  const clock = fakeClock();
  try {
    const fetchImpl = fakeFetchSequence([{ ok: true, result: { message_id: 1 } }]);
    const client = new TelegramClient({ botToken: 't', fetchImpl, sleepImpl: clock.sleep, minSendSpacingMs: 1100 });

    await client.sendMessage({ chatId: '1', text: 'first' });
    assert.deepEqual(clock.waits, [], 'first send in a fresh client should not wait');

    await client.sendMessage({ chatId: '1', text: 'second' });
    assert.deepEqual(clock.waits, [1100], 'back-to-back send must wait the full spacing since no time passed');
  } finally {
    clock.restore();
  }
});

test('a send does not wait if enough real time already elapsed since the last one', async () => {
  const clock = fakeClock();
  try {
    const fetchImpl = fakeFetchSequence([{ ok: true, result: { message_id: 1 } }]);
    const client = new TelegramClient({ botToken: 't', fetchImpl, sleepImpl: clock.sleep, minSendSpacingMs: 1100 });

    await client.sendMessage({ chatId: '1', text: 'first' });
    clock.advance(2000); // pretend 2s of real work happened between sends
    await client.sendMessage({ chatId: '1', text: 'second' });
    assert.deepEqual(clock.waits, [], 'spacing requirement was already satisfied by elapsed time');
  } finally {
    clock.restore();
  }
});

test('concurrent sends are serialized, not fired in parallel', async () => {
  const clock = fakeClock();
  try {
    const fetchImpl = fakeFetchSequence([{ ok: true, result: { message_id: 1 } }]);
    const client = new TelegramClient({ botToken: 't', fetchImpl, sleepImpl: clock.sleep, minSendSpacingMs: 1100 });

    // Fire three sends "at once" (no await between them) — a burst, exactly like notifyTimeouts
    // discovering many timed-out requests in a single pass after a restart.
    await Promise.all([
      client.sendMessage({ chatId: '1', text: 'a' }),
      client.sendMessage({ chatId: '1', text: 'b' }),
      client.sendMessage({ chatId: '1', text: 'c' })
    ]);
    assert.deepEqual(clock.waits, [1100, 1100], 'the 2nd and 3rd sends each wait a full spacing interval behind the one before it');
  } finally {
    clock.restore();
  }
});

test('a 429 response backs off by Telegram-reported retry_after before the next send', async () => {
  const clock = fakeClock();
  try {
    const fetchImpl = fakeFetchSequence([
      { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 5 } },
      { ok: true, result: { message_id: 2 } }
    ]);
    const client = new TelegramClient({ botToken: 't', fetchImpl, sleepImpl: clock.sleep, minSendSpacingMs: 1100 });

    await assert.rejects(() => client.sendMessage({ chatId: '1', text: 'a' }), /429/);
    assert.ok(clock.waits.includes(5000), 'must back off by the server-reported 5000ms after a 429');

    clock.waits.length = 0;
    await client.sendMessage({ chatId: '1', text: 'b' });
    // lastSendAt is stamped when the backoff wait finishes, so the normal spacing still
    // applies on top — slightly more cautious right after a real rate-limit hit, by design.
    assert.deepEqual(clock.waits, [1100], 'normal spacing still applies after the backoff completes');
  } finally {
    clock.restore();
  }
});

test('one failed send does not wedge later sends in the queue', async () => {
  const clock = fakeClock();
  try {
    const fetchImpl = fakeFetchSequence([
      { ok: false, error_code: 400, description: 'Bad Request' },
      { ok: true, result: { message_id: 3 } }
    ]);
    const client = new TelegramClient({ botToken: 't', fetchImpl, sleepImpl: clock.sleep, minSendSpacingMs: 1100 });

    const first = client.sendMessage({ chatId: '1', text: 'a' });
    const second = client.sendMessage({ chatId: '1', text: 'b' });
    await assert.rejects(() => first, /Bad Request/);
    const result = await second;
    assert.deepEqual(result, { message_id: 3 }, 'second send still completes despite the first one failing');
  } finally {
    clock.restore();
  }
});

test('getUpdates is not subject to send spacing (long-poll must never wait behind it)', async () => {
  const clock = fakeClock();
  try {
    const fetchImpl = fakeFetchSequence([{ ok: true, result: [] }]);
    const client = new TelegramClient({ botToken: 't', fetchImpl, sleepImpl: clock.sleep, minSendSpacingMs: 1100 });
    await client.getUpdates({ offset: 1 });
    assert.deepEqual(clock.waits, [], 'getUpdates must bypass the send throttle entirely');
  } finally {
    clock.restore();
  }
});
