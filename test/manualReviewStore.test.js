'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { ManualReviewStore } = require('../src/manualReviewStore');

test('manual review store caps entries to the latest 100 per request type', () => {
  const root = mkdtempSync(join(tmpdir(), 'manual-review-'));
  try {
    const store = new ManualReviewStore({ rootDir: root, limitPerType: 100 });
    for (let index = 1; index <= 105; index += 1) {
      store.record({
        request: {
          requestId: `REQ-${index}`,
          requestType: 'LCL',
          operator: 'BANGLALINK',
          payload: `019${index}`,
          requesterName: 'Tester'
        },
        operator: 'BANGLALINK',
        messageBody: `reply-${index}`,
        analysis: { confidence: 'HIGH', trainingMatch: { score: index } },
        source: 'auto_match'
      });
    }

    const filePath = join(root, 'LCL.json');
    assert.equal(existsSync(filePath), true);
    const rows = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(rows.length, 100);
    assert.equal(rows[0].requestId, 'REQ-6');
    assert.equal(rows.at(-1).requestId, 'REQ-105');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('manual review store deduplicates the same request/operator/message triple', () => {
  const root = mkdtempSync(join(tmpdir(), 'manual-review-'));
  try {
    const store = new ManualReviewStore({ rootDir: root, limitPerType: 100 });
    const payload = {
      request: {
        requestId: 'REQ-1',
        requestType: 'LRL',
        operator: 'GP',
        payload: '01712345678',
        requesterName: 'Tester'
      },
      operator: 'GP',
      messageBody: 'No RL Info Found of 1712345678 [GP]',
      analysis: { confidence: 'MEDIUM', trainingMatch: { score: 2 } },
      source: 'manual_match'
    };

    store.record(payload);
    store.record(payload);

    const rows = JSON.parse(readFileSync(join(root, 'LRL.json'), 'utf8'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].messageBody, payload.messageBody);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
