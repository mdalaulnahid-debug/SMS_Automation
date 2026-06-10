'use strict';

const { existsSync, mkdirSync, readdirSync, writeFileSync } = require('node:fs');
const { join, extname, basename } = require('node:path');

const TRAINING_ROOT = process.env.TRAINING_ROOT || join(__dirname, '..', 'Training Data', 'Automation');
const OUTPUT_FILE = process.env.TRAINING_OUTPUT || join(__dirname, '..', 'data', 'reply-patterns.json');

function main() {
  let xlsx;
  try {
    xlsx = require('xlsx');
  } catch (error) {
    throw new Error('Missing dependency "xlsx". Run: npm install');
  }

  const examples = [];
  walk(TRAINING_ROOT, (filePath) => {
    if (!['.xlsx', '.xls', '.xlsm'].includes(extname(filePath).toLowerCase())) return;
    examples.push(...readWorkbook(xlsx, filePath));
  });

  const output = {
    generatedAt: new Date().toISOString(),
    sourceRoot: TRAINING_ROOT,
    summary: buildSummary(examples),
    examples,
    patterns: buildPatterns(examples)
  };

  mkdirSync(join(__dirname, '..', 'data'), { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Imported ${examples.length} training rows into ${OUTPUT_FILE}`);
}

function walk(directory, visitor) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, visitor);
    } else {
      visitor(fullPath);
    }
  }
}

function readWorkbook(xlsx, filePath) {
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  return workbook.SheetNames.flatMap((sheetName) => {
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
      defval: '',
      raw: false
    });
    return rows.map((row, index) => normalizeRow(filePath, sheetName, row, index + 2));
  }).filter(Boolean);
}

function normalizeRow(filePath, sheetName, row, rowNumber) {
  const requestType = inferRequestType(filePath, row);
  const operator = inferOperator(filePath, row);
  const requestText = pick(row, ['request', 'request text', 'sms request', 'query', 'input']);
  const replyText = pick(row, ['reply', 'response', 'operator reply', 'sms reply', 'output']);

  if (!requestText && !replyText) return null;

  return {
    sourceFile: filePath,
    sourceSheet: sheetName,
    sourceRow: rowNumber,
    fileName: basename(filePath),
    requestType,
    operator,
    requestText,
    replyText,
    raw: row
  };
}

function pick(row, names) {
  const entries = Object.entries(row);
  for (const name of names) {
    const found = entries.find(([key]) => normalizeHeader(key) === normalizeHeader(name));
    if (found && String(found[1]).trim()) return String(found[1]).trim();
  }
  return '';
}

function inferRequestType(filePath, row) {
  const joined = `${filePath} ${Object.values(row).join(' ')}`.toUpperCase();
  return ['IMEI-MS', 'MS-NID', 'NID-MS', 'LRL', 'LCL'].find((type) => joined.includes(type)) || '';
}

function inferOperator(filePath, row) {
  const joined = `${filePath} ${Object.values(row).join(' ')}`.toUpperCase();
  if (joined.includes('BANGLALINK')) return 'BANGLALINK';
  if (joined.includes('ROBI')) return 'ROBI';
  if (joined.includes('GRAMEENPHONE') || joined.includes('GP')) return 'GP';
  return '';
}

function buildPatterns(examples) {
  const grouped = {};
  for (const example of examples) {
    if (!example.requestType || !example.replyText) continue;
    const key = `${example.requestType}:${example.operator || 'UNKNOWN'}`;
    grouped[key] ||= {
      requestType: example.requestType,
      operator: example.operator || 'UNKNOWN',
      keywords: {}
    };
    for (const token of tokenize(example.replyText)) {
      if (isVolatileToken(token)) continue;
      grouped[key].keywords[token] = (grouped[key].keywords[token] || 0) + 1;
    }
  }

  return Object.values(grouped).map((group) => ({
    ...group,
    keywords: Object.entries(group.keywords)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([token, count]) => ({ token, count }))
  }));
}

function buildSummary(examples) {
  const summary = {
    totalExamples: examples.length,
    blankReplies: examples.filter((example) => !example.replyText).length,
    byRequestType: {},
    byOperator: {},
    byRequestTypeAndOperator: {}
  };

  for (const example of examples) {
    increment(summary.byRequestType, example.requestType || 'UNKNOWN');
    increment(summary.byOperator, example.operator || 'UNKNOWN');
    increment(
      summary.byRequestTypeAndOperator,
      `${example.requestType || 'UNKNOWN'}:${example.operator || 'UNKNOWN'}`
    );
  }

  return summary;
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .match(/[a-z0-9]{3,}|[\u0980-\u09FF]{2,}/g) || [];
}

function isVolatileToken(token) {
  return /^\d{3,}$/.test(token) || /^\d{4}-?\d{2}-?\d{2}/.test(token);
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function normalizeHeader(value) {
  return String(value).trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

main();
