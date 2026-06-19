'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const xlsx = require('xlsx');

const {
  loadTrainingCatalog,
  matchReplyAgainstTraining,
  scoreReplyFamiliesFromTraining
} = require('../src/trainingData');

function writeWorkbook(filePath, rows, sheetName = 'Sheet1') {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
  xlsx.writeFile(workbook, filePath);
}

test('matchReplyAgainstTraining uses curated workbook content', () => {
  const root = mkdtempSync(join(tmpdir(), 'training-data-'));
  try {
    writeWorkbook(join(root, 'LCL.xlsx'), [
      {
        Request: 'LCL 01971029492',
        Reply: 'MSISDN: 8801971029492, BPARTY: 880711740273257, UsageType: MOC, IMEI: 352640113845900 - Banglalink'
      }
    ]);

    const match = matchReplyAgainstTraining({
      requestType: 'LCL',
      operator: 'BANGLALINK',
      messageBody: 'MSISDN: 8801971029492, BPARTY: 880711740273257, UsageType: MOC - Banglalink',
      rootDir: root
    });

    assert.equal(match.matched, true);
    assert.ok(match.score > 0);
    assert.ok(match.keywordHits.some((hit) => hit.token === 'bparty'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scoreReplyFamiliesFromTraining ranks the closest curated family first', () => {
  const root = mkdtempSync(join(tmpdir(), 'training-data-'));
  try {
    writeWorkbook(join(root, 'LRL.xlsx'), [
      {
        Request: 'LRL 01724034442',
        Reply: 'No RL Info Found of 1724034442 [GP]'
      }
    ]);
    writeWorkbook(join(root, 'LCL.xlsx'), [
      {
        Request: 'LCL 01971029492',
        Reply: 'MSISDN: 8801971029492, BPARTY: 880711740273257, UsageType: MOC, IMEI: 352640113845900 - Banglalink'
      }
    ]);

    const scores = scoreReplyFamiliesFromTraining(
      'MSISDN: 8801971029492, BPARTY: 880711740273257, UsageType: MOC - Banglalink',
      'BANGLALINK',
      root
    );

    assert.equal(scores[0].requestType, 'LCL');
    assert.ok(scores[0].score > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadTrainingCatalog ignores temp and non-request workbooks', () => {
  const root = mkdtempSync(join(tmpdir(), 'training-data-'));
  try {
    writeWorkbook(join(root, 'LCL.xlsx'), [{ Request: 'LCL 1', Reply: 'BPARTY one' }]);
    writeWorkbook(join(root, '~$LCL.xlsx'), [{ Request: 'LCL 2', Reply: 'ignored' }]);
    writeWorkbook(join(root, 'Random.xlsx'), [{ Request: 'X', Reply: 'ignored' }]);
    mkdirSync(join(root, 'nested'));

    const catalog = loadTrainingCatalog(root);
    assert.equal(catalog.files.length, 1);
    assert.equal(catalog.examples.length, 1);
    assert.ok(catalog.files[0].endsWith('LCL.xlsx'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
