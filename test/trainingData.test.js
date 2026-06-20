'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const xlsx = require('xlsx');

const {
  loadTrainingCatalog,
  rebuildTrainingCache,
  matchReplyAgainstTraining,
  scoreReplyFamiliesFromTraining
} = require('../src/trainingData');

function writeWorkbook(filePath, rows, sheetName = 'Sheet1') {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
  xlsx.writeFile(workbook, filePath);
}

// Simulates a hand-maintained workbook where a title/blank row sits above the real
// header — e.g. a merged "MS-NID Replies" title row before "SL NO | Request | Reply".
function writeWorkbookWithLeadingRow(filePath, headerRow, dataRows, sheetName = 'Sheet1') {
  const workbook = xlsx.utils.book_new();
  const aoa = [['MS-NID Replies — Curated'], headerRow, ...dataRows];
  const worksheet = xlsx.utils.aoa_to_sheet(aoa);
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
  xlsx.writeFile(workbook, filePath);
}

test('matchReplyAgainstTraining uses curated workbook content', () => {
  const root = mkdtempSync(join(tmpdir(), 'training-data-'));
  const cacheDir = join(root, 'training-cache');
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
      rootDir: root,
      cacheDir
    });

    assert.equal(match.matched, true);
    assert.ok(match.score > 0);
    assert.ok(match.keywordHits.some((hit) => hit.token === 'bparty'));
    assert.equal(existsSync(join(cacheDir, 'LCL.json')), true);
    assert.equal(existsSync(join(cacheDir, 'index.json')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scoreReplyFamiliesFromTraining ranks the closest curated family first', () => {
  const root = mkdtempSync(join(tmpdir(), 'training-data-'));
  const cacheDir = join(root, 'training-cache');
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
      root,
      cacheDir
    );

    assert.equal(scores[0].requestType, 'LCL');
    assert.ok(scores[0].score > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadTrainingCatalog ignores temp and non-request workbooks', () => {
  const root = mkdtempSync(join(tmpdir(), 'training-data-'));
  const cacheDir = join(root, 'training-cache');
  try {
    writeWorkbook(join(root, 'LCL.xlsx'), [{ Request: 'LCL 1', Reply: 'BPARTY one' }]);
    writeWorkbook(join(root, '~$LCL.xlsx'), [{ Request: 'LCL 2', Reply: 'ignored' }]);
    writeWorkbook(join(root, 'Random.xlsx'), [{ Request: 'X', Reply: 'ignored' }]);
    mkdirSync(join(root, 'nested'));

    const catalog = loadTrainingCatalog({ rootDir: root, cacheDir });
    assert.equal(catalog.files.length, 1);
    assert.equal(catalog.examples.length, 1);
    assert.ok(catalog.files[0].endsWith('LCL.xlsx'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rebuildTrainingCache writes normalized cache file from workbook source', () => {
  const root = mkdtempSync(join(tmpdir(), 'training-data-'));
  const cacheDir = join(root, 'nested', 'training-cache');
  try {
    writeWorkbook(join(root, 'LRL.xlsx'), [
      {
        Request: 'LRL 01724034442',
        Reply: 'No RL Info Found of 1724034442 [GP]'
      }
    ]);

    const catalog = rebuildTrainingCache({ rootDir: root, cacheDir });
    const savedIndex = JSON.parse(readFileSync(join(cacheDir, 'index.json'), 'utf8'));
    const savedType = JSON.parse(readFileSync(join(cacheDir, 'LRL.json'), 'utf8'));

    assert.equal(catalog.examples.length, 1);
    assert.equal(savedType.examples.length, 1);
    assert.equal(savedType.patterns[0].requestType, 'LRL');
    assert.equal(savedIndex.summary.totalExamples, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readWorkbook finds the header row even when a title row sits above it', () => {
  const root = mkdtempSync(join(tmpdir(), 'training-data-'));
  const cacheDir = join(root, 'training-cache');
  try {
    writeWorkbookWithLeadingRow(
      join(root, 'MS-NID.xlsx'),
      ['SL NO', 'Request', 'Reply'],
      [
        [1, 'MS-NID 01712345678', 'MSISDN: 8801712345678, NID: 1234567890, DoB: 1990-01-01']
      ]
    );

    const catalog = rebuildTrainingCache({ rootDir: root, cacheDir });
    assert.equal(catalog.examples.length, 1);
    assert.equal(catalog.examples[0].requestType, 'MS-NID');
    assert.match(catalog.examples[0].replyText, /NID: 1234567890/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadTrainingCatalog refreshes cache after workbook changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'training-data-'));
  const cacheDir = join(root, 'training-cache');
  try {
    const workbookPath = join(root, 'LCL.xlsx');
    writeWorkbook(workbookPath, [
      { Request: 'LCL 01971029492', Reply: 'BPARTY MOC Banglalink' }
    ]);
    const first = loadTrainingCatalog({ rootDir: root, cacheDir });
    assert.equal(first.examples.length, 1);

    await new Promise((resolve) => setTimeout(resolve, 1200));
    writeWorkbook(workbookPath, [
      { Request: 'LCL 01971029492', Reply: 'BPARTY MOC Banglalink' },
      { Request: 'LCL 01971020000', Reply: 'BPARTY SMSMT Banglalink' }
    ]);

    const second = loadTrainingCatalog({ rootDir: root, cacheDir });
    const savedType = JSON.parse(readFileSync(join(cacheDir, 'LCL.json'), 'utf8'));
    assert.equal(second.examples.length, 2);
    assert.equal(savedType.examples.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
