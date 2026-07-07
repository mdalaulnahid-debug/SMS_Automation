'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { QuotaTracker } = require('../src/quota');

function fakeClock(startAt = 1_000_000) {
  let now = startAt;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

test('allows requests up to maxRequests, then blocks and requires verification', () => {
  const clock = fakeClock();
  const tracker = new QuotaTracker({ maxRequests: 3, windowMs: 60_000, now: clock.now });

  for (let i = 0; i < 3; i++) {
    const result = tracker.recordRequest('officer-1');
    assert.equal(result.allowed, true, `request ${i + 1} of 3 should be allowed`);
    assert.equal(result.requiresVerification, false);
  }

  const fourth = tracker.recordRequest('officer-1');
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.requiresVerification, true);
  assert.equal(fourth.remaining, 0);
});

test('a naturally-elapsed window resets the count without being a violation', () => {
  const clock = fakeClock();
  const tracker = new QuotaTracker({ maxRequests: 2, windowMs: 1000, now: clock.now });

  tracker.recordRequest('officer-1');
  tracker.recordRequest('officer-1');
  assert.equal(tracker.recordRequest('officer-1').allowed, false, 'quota exhausted within the window');

  clock.advance(1500); // past the 1000ms window
  const afterWindow = tracker.recordRequest('officer-1');
  assert.equal(afterWindow.allowed, true, 'a new window should reset the count');
  assert.equal(afterWindow.remaining, 1);
});

test('resetAfterVerification reopens a fresh window immediately, without waiting for elapse', () => {
  const clock = fakeClock();
  const tracker = new QuotaTracker({ maxRequests: 1, windowMs: 60_000, now: clock.now });

  tracker.recordRequest('officer-1');
  assert.equal(tracker.recordRequest('officer-1').allowed, false);

  tracker.resetAfterVerification('officer-1');
  const afterVerify = tracker.recordRequest('officer-1');
  assert.equal(afterVerify.allowed, true, 'verification should reopen the session even though the window has not elapsed');
});

test('officers are tracked independently — one officer hitting quota does not affect another', () => {
  const clock = fakeClock();
  const tracker = new QuotaTracker({ maxRequests: 1, windowMs: 60_000, now: clock.now });

  tracker.recordRequest('officer-1');
  assert.equal(tracker.recordRequest('officer-1').allowed, false);
  assert.equal(tracker.recordRequest('officer-2').allowed, true, 'a different officer must have their own quota');
});

test('per-call overrides let an admin tune limits per officer without a new tracker', () => {
  const clock = fakeClock();
  const tracker = new QuotaTracker({ maxRequests: 5, windowMs: 60_000, now: clock.now });

  const result = tracker.recordRequest('field-officer', { maxRequests: 100 });
  assert.equal(result.remaining, 99, 'the override should apply instead of the tracker default');
});

test('getSession returns null for an officer with no recorded requests', () => {
  const tracker = new QuotaTracker();
  assert.equal(tracker.getSession('never-seen'), null);
});
