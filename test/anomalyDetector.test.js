'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AnomalyDetector } = require('../src/anomalyDetector');

// 2026-07-08 is a Wednesday. Base timestamps are chosen in UTC then checked
// against the fixed BST (UTC+6) offset the detector uses internally.
function bstNoon() {
  return new Date('2026-07-08T06:00:00.000Z').getTime(); // 12:00 BST
}
function bstMidnight() {
  return new Date('2026-07-08T18:00:00.000Z').getTime(); // 00:00 BST (next day)
}

test('flags an off-hours submission (23:00-06:00 local) and not a daytime one', () => {
  const detector = new AnomalyDetector();
  const daytime = detector.recordAndCheck('officer-1', { timestamp: bstNoon() });
  assert.ok(!daytime.some((f) => f.type === 'OFF_HOURS_SUBMISSION'));

  const midnight = detector.recordAndCheck('officer-2', { timestamp: bstMidnight() });
  assert.ok(midnight.some((f) => f.type === 'OFF_HOURS_SUBMISSION'));
});

test('flags burst volume once the threshold is exceeded within the window, not before', () => {
  const detector = new AnomalyDetector({ burstThreshold: 3, burstWindowMs: 60_000 });
  const base = bstNoon();
  let flags;
  for (let i = 0; i < 3; i++) {
    flags = detector.recordAndCheck('officer-1', { timestamp: base + i * 1000 });
    assert.ok(!flags.some((f) => f.type === 'BURST_VOLUME'), `request ${i + 1} should not trip burst yet`);
  }
  flags = detector.recordAndCheck('officer-1', { timestamp: base + 4000 });
  assert.ok(flags.some((f) => f.type === 'BURST_VOLUME'));
});

test('burst window rolls off — old requests outside the window do not count toward the threshold', () => {
  const detector = new AnomalyDetector({ burstThreshold: 2, burstWindowMs: 10_000 });
  const base = bstNoon();
  detector.recordAndCheck('officer-1', { timestamp: base });
  detector.recordAndCheck('officer-1', { timestamp: base + 2000 });
  // Well past the 10s window — the two above should have rolled off.
  const flags = detector.recordAndCheck('officer-1', { timestamp: base + 60_000 });
  assert.ok(!flags.some((f) => f.type === 'BURST_VOLUME'));
});

test('does not flag identity drift on the first sighting — needs a prior baseline', () => {
  const detector = new AnomalyDetector();
  const flags = detector.recordAndCheck('officer-1', { timestamp: bstNoon(), languageCode: 'en', username: 'ofc_rahim' });
  assert.ok(!flags.some((f) => f.type === 'IDENTITY_DRIFT'));
});

test('flags language_code drift once a baseline exists and it changes', () => {
  const detector = new AnomalyDetector();
  detector.recordAndCheck('officer-1', { timestamp: bstNoon(), languageCode: 'en' });
  const flags = detector.recordAndCheck('officer-1', { timestamp: bstNoon() + 1000, languageCode: 'ru' });
  assert.ok(flags.some((f) => f.type === 'IDENTITY_DRIFT' && f.detail.includes('language_code')));
});

test('flags username drift once a baseline exists and it changes', () => {
  const detector = new AnomalyDetector();
  detector.recordAndCheck('officer-1', { timestamp: bstNoon(), username: 'ofc_rahim' });
  const flags = detector.recordAndCheck('officer-1', { timestamp: bstNoon() + 1000, username: 'someone_else' });
  assert.ok(flags.some((f) => f.type === 'IDENTITY_DRIFT' && f.detail.includes('username')));
});

test('does not flag drift when language_code/username stay consistent', () => {
  const detector = new AnomalyDetector();
  detector.recordAndCheck('officer-1', { timestamp: bstNoon(), languageCode: 'en', username: 'ofc_rahim' });
  const flags = detector.recordAndCheck('officer-1', { timestamp: bstNoon() + 1000, languageCode: 'en', username: 'ofc_rahim' });
  assert.ok(!flags.some((f) => f.type === 'IDENTITY_DRIFT'));
});

test('does not flag a request-type shift before enough history has built up', () => {
  const detector = new AnomalyDetector({ minHistoryForPatternShift: 5 });
  const base = bstNoon();
  for (let i = 0; i < 4; i++) {
    detector.recordAndCheck('officer-1', { timestamp: base + i * 1000, requestType: 'LRL' });
  }
  const flags = detector.recordAndCheck('officer-1', { timestamp: base + 5000, requestType: 'IMEI-MS' });
  assert.ok(!flags.some((f) => f.type === 'REQUEST_TYPE_SHIFT'), 'only 4 prior requests — below minHistoryForPatternShift');
});

test('flags a request-type shift once a dominant pattern is established and broken', () => {
  const detector = new AnomalyDetector({ minHistoryForPatternShift: 5, patternDominanceRatio: 0.7 });
  const base = bstNoon();
  for (let i = 0; i < 6; i++) {
    detector.recordAndCheck('officer-1', { timestamp: base + i * 1000, requestType: 'LRL' });
  }
  const flags = detector.recordAndCheck('officer-1', { timestamp: base + 7000, requestType: 'IMEI-MS' });
  assert.ok(flags.some((f) => f.type === 'REQUEST_TYPE_SHIFT'));
});

test('does not flag a request-type shift when the officer has no dominant pattern (evenly mixed)', () => {
  const detector = new AnomalyDetector({ minHistoryForPatternShift: 4, patternDominanceRatio: 0.7 });
  const base = bstNoon();
  const types = ['LRL', 'LCL', 'IMEI-MS', 'MS-NID'];
  types.forEach((t, i) => detector.recordAndCheck('officer-1', { timestamp: base + i * 1000, requestType: t }));
  const flags = detector.recordAndCheck('officer-1', { timestamp: base + 5000, requestType: 'NID-MS' });
  assert.ok(!flags.some((f) => f.type === 'REQUEST_TYPE_SHIFT'), 'no single type dominates 70% of history');
});

test('a request with no requestType (unparsed) never trips the pattern-shift check nor pollutes history', () => {
  const detector = new AnomalyDetector({ minHistoryForPatternShift: 2 });
  const base = bstNoon();
  detector.recordAndCheck('officer-1', { timestamp: base, requestType: 'LRL' });
  detector.recordAndCheck('officer-1', { timestamp: base + 1000, requestType: 'LRL' });
  const flags = detector.recordAndCheck('officer-1', { timestamp: base + 2000 }); // no requestType
  assert.ok(!flags.some((f) => f.type === 'REQUEST_TYPE_SHIFT'));
});

test('profiles are isolated per officer', () => {
  const detector = new AnomalyDetector({ burstThreshold: 1, burstWindowMs: 60_000 });
  const base = bstNoon();
  const a = detector.recordAndCheck('officer-a', { timestamp: base });
  const b = detector.recordAndCheck('officer-b', { timestamp: base + 500 });
  assert.ok(!a.some((f) => f.type === 'BURST_VOLUME'));
  assert.ok(!b.some((f) => f.type === 'BURST_VOLUME'), "officer-b's first request must not inherit officer-a's burst count");
});
