'use strict';

const { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs');
const { basename, dirname, extname, join } = require('node:path');
const { REQUEST_TYPES } = require('./domain');

const DEFAULT_TRAINING_ROOT = process.env.TRAINING_ROOT || join(__dirname, '..', 'Training Data', 'Automation');
const DEFAULT_CACHE_FILE = process.env.TRAINING_CACHE_FILE || join(__dirname, '..', 'data', 'training-cache.json');
const TRAINING_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsm']);

let cachedCatalog = null;
let cachedSignature = '';
let cachedCacheFile = '';

function loadTrainingCatalog({
  rootDir = DEFAULT_TRAINING_ROOT,
  cacheFile = DEFAULT_CACHE_FILE
} = {}) {
  const signature = buildSignature(rootDir);
  if (cachedCatalog && cachedSignature === signature && cachedCacheFile === cacheFile) {
    return cachedCatalog;
  }

  const fromCache = readTrainingCache(cacheFile);
  if (fromCache && fromCache.signature === signature && fromCache.rootDir === rootDir) {
    cachedCatalog = fromCache.catalog;
    cachedSignature = signature;
    cachedCacheFile = cacheFile;
    return cachedCatalog;
  }

  const catalog = rebuildTrainingCache({ rootDir, cacheFile, signature });
  cachedCatalog = catalog;
  cachedSignature = signature;
  cachedCacheFile = cacheFile;
  return catalog;
}

function rebuildTrainingCache({
  rootDir = DEFAULT_TRAINING_ROOT,
  cacheFile = DEFAULT_CACHE_FILE,
  signature = buildSignature(rootDir)
} = {}) {
  const xlsx = loadXlsx();
  if (!xlsx) {
    const empty = emptyCatalog(rootDir, []);
    writeTrainingCache(cacheFile, { signature, rootDir, catalog: empty });
    return empty;
  }

  const files = listWorkbookFiles(rootDir);
  const examples = files.flatMap((filePath) => readWorkbook(xlsx, filePath));
  const patterns = buildPatterns(examples);
  const summary = buildSummary(examples);
  const catalog = { rootDir, files, examples, patterns, summary };

  writeTrainingCache(cacheFile, { signature, rootDir, catalog });
  return catalog;
}

function matchReplyAgainstTraining({
  requestType,
  operator,
  messageBody,
  rootDir = DEFAULT_TRAINING_ROOT,
  cacheFile = DEFAULT_CACHE_FILE
}) {
  const bodyTokens = tokenizeTrainingText(messageBody);
  if (!bodyTokens.length) return emptyMatch();

  const catalog = loadTrainingCatalog({ rootDir, cacheFile });
  const patterns = catalog.patterns.filter((pattern) => {
    return pattern.requestType === requestType && (!pattern.operator || pattern.operator === operator);
  });
  const examples = catalog.examples.filter((example) => {
    return example.requestType === requestType
      && (!example.operator || example.operator === operator)
      && example.replyText;
  });

  const keywordHits = patterns.flatMap((pattern) => {
    return pattern.keywords
      .filter(({ token }) => bodyTokens.includes(token))
      .map(({ token, count }) => ({ token, count, operator: pattern.operator || operator || '' }));
  }).sort((a, b) => b.count - a.count || a.token.localeCompare(b.token));

  const exampleHits = examples
    .map((example) => scoreExampleOverlap(example, bodyTokens))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.overlapTokens.length - a.overlapTokens.length)
    .slice(0, 5);

  const score = keywordHits.reduce((sum, hit) => sum + Math.min(hit.count, 3), 0)
    + exampleHits.reduce((sum, hit) => sum + hit.score, 0);

  return {
    matched: keywordHits.length >= 2 || exampleHits.some((entry) => entry.score >= 2),
    score,
    keywordHits: keywordHits.slice(0, 10),
    exampleHits
  };
}

function scoreReplyFamiliesFromTraining(
  messageBody,
  operator,
  rootDir = DEFAULT_TRAINING_ROOT,
  cacheFile = DEFAULT_CACHE_FILE
) {
  const bodyTokens = tokenizeTrainingText(messageBody);
  if (!bodyTokens.length) return [];

  loadTrainingCatalog({ rootDir, cacheFile });
  const scores = Object.values(REQUEST_TYPES).map((requestType) => {
    const result = matchReplyAgainstTraining({ requestType, operator, messageBody, rootDir, cacheFile });
    return {
      requestType,
      score: result.score,
      matched: result.matched
    };
  }).filter((entry) => entry.score > 0 || entry.matched);

  return scores.sort((a, b) => b.score - a.score || a.requestType.localeCompare(b.requestType));
}

function readWorkbook(xlsx, filePath) {
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  return workbook.SheetNames.flatMap((sheetName) => {
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
      defval: '',
      raw: false
    });
    return rows.map((row, index) => normalizeRow(filePath, sheetName, row, index + 2)).filter(Boolean);
  });
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
    tokens: tokenizeTrainingText(replyText)
  };
}

function buildPatterns(examples) {
  const grouped = new Map();
  for (const example of examples) {
    if (!example.requestType || !example.replyText) continue;
    const key = `${example.requestType}:${example.operator || ''}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        requestType: example.requestType,
        operator: example.operator || '',
        keywords: new Map()
      });
    }
    const group = grouped.get(key);
    for (const token of example.tokens) {
      group.keywords.set(token, (group.keywords.get(token) || 0) + 1);
    }
  }

  return [...grouped.values()].map((group) => ({
    requestType: group.requestType,
    operator: group.operator,
    keywords: [...group.keywords.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 50)
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
    increment(summary.byRequestTypeAndOperator, `${example.requestType || 'UNKNOWN'}:${example.operator || 'UNKNOWN'}`);
  }

  return summary;
}

function scoreExampleOverlap(example, bodyTokens) {
  const overlapTokens = [...new Set(example.tokens.filter((token) => bodyTokens.includes(token)))];
  return {
    sourceFile: example.sourceFile,
    sourceSheet: example.sourceSheet,
    sourceRow: example.sourceRow,
    score: overlapTokens.length,
    overlapTokens
  };
}

function tokenizeTrainingText(text) {
  const tokens = String(text || '').toLowerCase().match(/[a-z0-9]{3,}|[\u0980-\u09FF]{2,}/g) || [];
  return tokens.filter((token) => !isVolatileToken(token));
}

function isVolatileToken(token) {
  return /^\d{3,}$/.test(token) || /^\d{4}-?\d{2}-?\d{2}/.test(token);
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
  return Object.values(REQUEST_TYPES).find((type) => joined.includes(type)) || '';
}

function inferOperator(filePath, row) {
  const joined = `${filePath} ${Object.values(row).join(' ')}`.toUpperCase();
  if (joined.includes('BANGLALINK')) return 'BANGLALINK';
  if (joined.includes('ROBI')) return 'ROBI';
  if (joined.includes('GRAMEENPHONE') || joined.includes(' GP') || joined.includes('[GP]')) return 'GP';
  return '';
}

function normalizeHeader(value) {
  return String(value).trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function listWorkbookFiles(rootDir) {
  if (!existsSync(rootDir)) return [];
  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(rootDir, entry.name))
    .filter((filePath) => {
      const name = basename(filePath);
      const ext = extname(filePath).toLowerCase();
      return TRAINING_EXTENSIONS.has(ext)
        && !name.startsWith('~$')
        && !name.endsWith('.tmp');
    })
    .filter((filePath) => Object.values(REQUEST_TYPES).some((type) => basename(filePath).toUpperCase().includes(type)));
}

function buildSignature(rootDir) {
  const files = listWorkbookFiles(rootDir);
  const parts = [rootDir];
  for (const filePath of files) {
    const stats = statSync(filePath);
    parts.push(`${filePath}:${stats.mtimeMs}:${stats.size}`);
  }
  return parts.join('|');
}

function readTrainingCache(cacheFile) {
  if (!existsSync(cacheFile)) return null;
  try {
    return JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {
    return null;
  }
}

function writeTrainingCache(cacheFile, payload) {
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    ...payload
  }, null, 2), 'utf8');
}

function loadXlsx() {
  try {
    return require('xlsx');
  } catch {
    return null;
  }
}

function emptyCatalog(rootDir, files = []) {
  return { rootDir, files, examples: [], patterns: [], summary: buildSummary([]) };
}

function emptyMatch() {
  return {
    matched: false,
    score: 0,
    keywordHits: [],
    exampleHits: []
  };
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

module.exports = {
  DEFAULT_TRAINING_ROOT,
  DEFAULT_CACHE_FILE,
  loadTrainingCatalog,
  rebuildTrainingCache,
  matchReplyAgainstTraining,
  scoreReplyFamiliesFromTraining,
  tokenizeTrainingText
};
