'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OtpStore, generateCode } = require('../src/otp');

function fakeClock(startAt = 1_000_000) {
  let now = startAt;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

test('generateCode produces a 6-digit numeric, zero-padded string', () => {
  for (let i = 0; i < 20; i++) {
    const code = generateCode();
    assert.match(code, /^\d{6}$/);
  }
});

test('issueCode then verifyCode with the correct code succeeds', () => {
  const store = new OtpStore();
  const { code, throttled } = store.issueCode('officer-1');
  assert.equal(throttled, false);
  assert.match(code, /^\d{6}$/);
  const result = store.verifyCode('officer-1', code);
  assert.equal(result.ok, true);
});

test('verifying consumes the challenge — a second verify (even correct) fails afterward', () => {
  const store = new OtpStore();
  const { code } = store.issueCode('officer-1');
  assert.equal(store.verifyCode('officer-1', code).ok, true);
  const second = store.verifyCode('officer-1', code);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'NO_ACTIVE_CHALLENGE');
});

test('an incorrect code is rejected without consuming the challenge (can retry)', () => {
  const store = new OtpStore();
  const { code } = store.issueCode('officer-1');
  const wrong = store.verifyCode('officer-1', '000000' === code ? '111111' : '000000');
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, 'INCORRECT');
  // The real code should still work — one wrong guess doesn't burn the challenge.
  assert.equal(store.verifyCode('officer-1', code).ok, true);
});

test('exceeding max attempts locks out the challenge, even with the correct code afterward', () => {
  const store = new OtpStore({ maxAttempts: 3 });
  const { code } = store.issueCode('officer-1');
  const wrongCode = code === '000000' ? '111111' : '000000';

  assert.equal(store.verifyCode('officer-1', wrongCode).reason, 'INCORRECT');
  assert.equal(store.verifyCode('officer-1', wrongCode).reason, 'INCORRECT');
  const third = store.verifyCode('officer-1', wrongCode); // 3rd wrong attempt hits maxAttempts
  assert.equal(third.reason, 'ATTEMPTS_EXCEEDED');

  // Challenge is now consumed — even the correct code can't be used anymore.
  const attemptWithRealCode = store.verifyCode('officer-1', code);
  assert.equal(attemptWithRealCode.ok, false);
  assert.equal(attemptWithRealCode.reason, 'NO_ACTIVE_CHALLENGE');
});

test('an expired code is rejected', () => {
  const clock = fakeClock();
  const store = new OtpStore({ codeTtlMs: 1000, now: clock.now });
  const { code } = store.issueCode('officer-1');
  clock.advance(1500);
  const result = store.verifyCode('officer-1', code);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'EXPIRED');
});

test('verifying with no active challenge at all fails cleanly', () => {
  const store = new OtpStore();
  const result = store.verifyCode('never-issued', '123456');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_ACTIVE_CHALLENGE');
});

test('issuance is throttled after maxIssuancePerHour, protecting the officer\'s inbox from spam', () => {
  const clock = fakeClock();
  const store = new OtpStore({ maxIssuancePerHour: 2, now: clock.now });

  assert.equal(store.issueCode('officer-1').throttled, false);
  assert.equal(store.issueCode('officer-1').throttled, false);
  const third = store.issueCode('officer-1');
  assert.equal(third.throttled, true);
  assert.equal(third.code, null);
});

test('issuance throttle window rolls off after an hour', () => {
  const clock = fakeClock();
  const store = new OtpStore({ maxIssuancePerHour: 1, now: clock.now });

  store.issueCode('officer-1');
  assert.equal(store.issueCode('officer-1').throttled, true);

  clock.advance(61 * 60 * 1000); // just past the 1-hour issuance window
  assert.equal(store.issueCode('officer-1').throttled, false, 'the hour-old issuance should have rolled off');
});

test('issuing a new code replaces any prior unexpired challenge for that officer', () => {
  const store = new OtpStore();
  const first = store.issueCode('officer-1');
  const second = store.issueCode('officer-1');
  assert.notEqual(first.code, second.code, 'extremely unlikely collision aside, a fresh code should be generated');
  // Only the newest code should verify.
  assert.equal(store.verifyCode('officer-1', second.code).ok, true);
});
