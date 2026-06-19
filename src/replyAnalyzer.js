'use strict';

const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { REQUEST_TYPES } = require('./domain');
const { extractSilentReference } = require('./store');

const REPLY_PATTERNS = Object.freeze({
  [REQUEST_TYPES.LRL]: [/last\s+radio/i, /\blrl\b/i, /cell|lac|latitude|longitude|location/i],
  [REQUEST_TYPES.LCL]: [/last\s+call/i, /\blcl\b/i, /call|cell|lac|location/i],
  [REQUEST_TYPES.MS_NID]: [/nid|national\s+id/i, /name|dob|father|mother/i],
  [REQUEST_TYPES.NID_MS]: [/msisdn|mobile|subscriber|number/i],
  [REQUEST_TYPES.IMEI_MS]: [/imei/i, /msisdn|mobile|subscriber|number/i]
});

const STRONG_REPLY_FAMILY_PATTERNS = Object.freeze({
  [REQUEST_TYPES.LRL]: [
    /no\s+radio\s+location\s+found/i,
    /no\s+rl\s+info\s+found/i,
    /radio\s+location/i,
    /lastactivedatetime/i,
    /\blra:/i,
    /latitude/i,
    /longitude/i,
    /\blat\b/i,
    /\blong\b/i
  ],
  [REQUEST_TYPES.LCL]: [
    /msisdn\s+b\s*party/i,
    /\bbparty\b/i,
    /last\s+call\s+location/i,
    /usagetype\s*:/i,
    /\b(?:moc|mtc|smsmo|smsmt|call mo|call mt)\b/i
  ],
  [REQUEST_TYPES.MS_NID]: [
    /(?:^|\n)\s*msisdn[:\s]/i,
    /(?:^|\n).*\b(?:nid|dob)\b/i,
    /(?:^|\n).*,\s*\d{4}-\d{2}-\d{2}(?:\s|$)/i
  ],
  [REQUEST_TYPES.NID_MS]: [
    /(?:^|\n)\s*nid[:\s]/i,
    /(?:^|\n)\s*nid[^\n]*\b(?:msisdn|8801\d{9})/i,
    /no\s+data\s+found[^\n]*\bnid\b/i
  ],
  [REQUEST_TYPES.IMEI_MS]: [
    /(?:^|\n)\s*imei[:\s]/i,
    /\bmsisdn-date\b/i,
    /no\s+data\s+available\s+within\s+90\s+days/i,
    /(?:^|\n)\s*\d{14,15},\s*8801\d{9},\s*\d{8}/i
  ]
});

function analyzeOperatorReply({ request, messageBody }) {
  const body = String(messageBody || '');
  const expectedPatterns = REPLY_PATTERNS[request.requestType] || [];
  const matchedPatterns = expectedPatterns
    .map((pattern) => pattern.source)
    .filter((_, index) => expectedPatterns[index].test(body));
  const foundReference = extractSilentReference(body);
  const trainingMatch = matchTrainingPattern(request, body);
  const payloadMatch = payloadInReply(request.payload, body);
  const inferredReplyFamilies = inferReplyFamilies(body);

  return {
    requestType: request.requestType,
    referenceMatched: Boolean(foundReference && foundReference === request.silentReference),
    foundReference,
    payloadMatched: payloadMatch.matched,
    payloadMatchCount: payloadMatch.count,
    payloadMatches: payloadMatch.identifiers,
    patternMatched: matchedPatterns.length > 0 || trainingMatch.matched,
    matchedPatterns,
    trainingMatch,
    inferredReplyFamilies,
    confidence: confidenceScore({
      referenceMatched: Boolean(foundReference && foundReference === request.silentReference),
      payloadMatched: payloadMatch.matched,
      patternMatched: matchedPatterns.length > 0 || trainingMatch.matched
    })
  };
}

function inferReplyFamilies(messageBody) {
  const body = String(messageBody || '');
  const strongTypes = [];
  for (const [requestType, patterns] of Object.entries(STRONG_REPLY_FAMILY_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(body))) strongTypes.push(requestType);
  }
  return {
    strongTypes
  };
}

// Check if the request payload (phone number, NID, IMEI) appears in the reply body.
// Normalizes phone numbers (strips leading 0/+880) so "01712345678" matches "8801712345678".
function payloadInReply(payload, body) {
  if (!payload || !body) return { matched: false, count: 0, identifiers: [] };
  const normalizedBody = body.replace(/[\s\-().]/g, '');
  const identifiers = String(payload)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const matchedIdentifiers = identifiers.filter((identifier) => {
    const normalizedPayload = String(identifier).replace(/[\s\-().]/g, '');
    if (normalizedBody.includes(normalizedPayload)) return true;
    const stripped = normalizedPayload.replace(/^(?:\+?880|0)/, '');
    return stripped.length >= 10 && normalizedBody.includes(stripped);
  });
  return {
    matched: matchedIdentifiers.length > 0,
    count: matchedIdentifiers.length,
    identifiers: matchedIdentifiers
  };
}

function matchTrainingPattern(request, body) {
  const training = loadTrainingPatterns();
  const normalizedBody = body.toLowerCase();
  const groups = training.patterns.filter((pattern) => {
    return pattern.requestType === request.requestType && (!pattern.operator || request.operator === pattern.operator);
  });
  const matches = groups.flatMap((group) => {
    return group.keywords
      .filter(({ token }) => normalizedBody.includes(token.toLowerCase()))
      .map(({ token, count }) => ({ token, count, operator: group.operator }));
  });

  return {
    matched: matches.length > 0,
    matches: matches.slice(0, 10)
  };
}

function loadTrainingPatterns() {
  const filePath = join(__dirname, '..', 'data', 'reply-patterns.json');
  if (!existsSync(filePath)) return { patterns: [] };
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return { patterns: [] };
  }
}

function confidenceScore({ referenceMatched, payloadMatched, patternMatched }) {
  if (referenceMatched) return 'HIGH';
  if (payloadMatched && patternMatched) return 'HIGH';
  if (payloadMatched) return 'MEDIUM';
  if (patternMatched) return 'LOW';
  return 'UNKNOWN';
}

// Tokenise a reply body into meaningful words (≥4 chars, non-numeric).
function tokenizeReply(body) {
  return body
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !/^\d+$/.test(t));
}

/**
 * Save new keywords from a matched reply into data/reply-patterns.json.
 * Increments counts for existing tokens; adds new ones.
 * No-ops silently on any I/O error so a bad write never breaks the main flow.
 */
function saveMatchedReplyKeywords(requestType, operator, messageBody) {
  const filePath = join(__dirname, '..', 'data', 'reply-patterns.json');
  try {
    const training = loadTrainingPatterns();
    const tokens = tokenizeReply(messageBody);
    if (!tokens.length) return;

    let group = training.patterns.find(
      (p) => p.requestType === requestType && p.operator === operator
    );
    if (!group) {
      group = { requestType, operator, keywords: [] };
      training.patterns.push(group);
    }

    for (const token of tokens) {
      const existing = group.keywords.find((k) => k.token === token);
      if (existing) {
        existing.count += 1;
      } else {
        group.keywords.push({ token, count: 1 });
      }
    }

    writeFileSync(filePath, JSON.stringify(training, null, 2), 'utf8');
  } catch {
    // never throw — training auto-save must not affect core flow
  }
}

module.exports = {
  REPLY_PATTERNS,
  analyzeOperatorReply,
  inferReplyFamilies,
  matchTrainingPattern,
  saveMatchedReplyKeywords
};
