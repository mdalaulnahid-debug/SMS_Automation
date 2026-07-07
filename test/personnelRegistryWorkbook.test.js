'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRegistryWorkbook } = require('../src/personnelRegistry');

// Builds an in-memory .xlsx Buffer from an array-of-arrays, the same shape
// parseRegistryWorkbook expects to read — avoids needing a fixture file on
// disk, and lets each test express exactly the header row it's checking.
function bufferFromRows(rows) {
  const xlsx = require('xlsx');
  const sheet = xlsx.utils.aoa_to_sheet(rows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

test('parses a standard-header registry sheet into records', () => {
  const buffer = bufferFromRows([
    ['Name', 'Designation', 'Unit', 'Phone', 'Email'],
    ['SI Nazmul', 'Sub-Inspector', 'Bakerganj', '01712345678', 'nazmul@police.gov.bd'],
    ['OC Karim', 'Officer in Charge', 'Barishal Sadar', '01899999999', 'karim@police.gov.bd']
  ]);
  const records = parseRegistryWorkbook(buffer);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], {
    name: 'SI Nazmul',
    designation: 'Sub-Inspector',
    unit: 'Bakerganj',
    phone: '01712345678',
    email: 'nazmul@police.gov.bd'
  });
});

test('recognizes aliased column headers (case-insensitive)', () => {
  const buffer = bufferFromRows([
    ['Full Name', 'Rank', 'Station', 'Mobile', 'Official Email'],
    ['SI Nazmul', 'Sub-Inspector', 'Bakerganj', '01712345678', 'nazmul@police.gov.bd']
  ]);
  const records = parseRegistryWorkbook(buffer);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, 'SI Nazmul');
  assert.equal(records[0].phone, '01712345678');
});

test('works with only the required columns (Designation/Unit optional)', () => {
  const buffer = bufferFromRows([
    ['Name', 'Phone', 'Email'],
    ['SI Nazmul', '01712345678', 'nazmul@police.gov.bd']
  ]);
  const records = parseRegistryWorkbook(buffer);
  assert.equal(records.length, 1);
  assert.equal(records[0].designation, '');
  assert.equal(records[0].unit, '');
});

test('throws a clear error when a required column is missing', () => {
  const buffer = bufferFromRows([
    ['Name', 'Designation'],
    ['SI Nazmul', 'Sub-Inspector']
  ]);
  assert.throws(() => parseRegistryWorkbook(buffer), /must have Name, Phone, and Email columns/);
});

test('skips fully blank rows', () => {
  const buffer = bufferFromRows([
    ['Name', 'Phone', 'Email'],
    ['SI Nazmul', '01712345678', 'nazmul@police.gov.bd'],
    ['', '', ''],
    ['OC Karim', '01899999999', 'karim@police.gov.bd']
  ]);
  const records = parseRegistryWorkbook(buffer);
  assert.equal(records.length, 2);
});

test('drops rows missing name, phone, or email even if present in the sheet', () => {
  const buffer = bufferFromRows([
    ['Name', 'Phone', 'Email'],
    ['No Phone', '', 'nophone@example.com'],
    ['Complete', '01712345678', 'complete@example.com']
  ]);
  const records = parseRegistryWorkbook(buffer);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, 'Complete');
});

test('an empty sheet (headers only) returns an empty array, not an error', () => {
  const buffer = bufferFromRows([['Name', 'Phone', 'Email']]);
  assert.deepEqual(parseRegistryWorkbook(buffer), []);
});
