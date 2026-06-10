'use strict';

const { existsSync, readFileSync } = require('node:fs');
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

function analyzeOperatorReply({ request, messageBody }) {
  const body = String(messageBody || '');
  const expectedPatterns = REPLY_PATTERNS[request.requestType] || [];
  const matchedPatterns = expectedPatterns
    .map((pattern) => pattern.source)
    .filter((_, index) => expectedPatterns[index].test(body));
  const foundReference = extractSilentReference(body);
  const trainingMatch = matchTrainingPattern(request, body);

  return {
    requestType: request.requestType,
    referenceMatched: Boolean(foundReference && foundReference === request.silentReference),
    foundReference,
    patternMatched: matchedPatterns.length > 0 || trainingMatch.matched,
    matchedPatterns,
    trainingMatch,
    confidence: confidenceScore({
      referenceMatched: Boolean(foundReference && foundReference === request.silentReference),
      patternMatched: matchedPatterns.length > 0 || trainingMatch.matched
    })
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

function confidenceScore({ referenceMatched, patternMatched }) {
  if (referenceMatched && patternMatched) return 'HIGH';
  if (referenceMatched) return 'MEDIUM';
  if (patternMatched) return 'LOW';
  return 'UNKNOWN';
}

module.exports = {
  REPLY_PATTERNS,
  analyzeOperatorReply,
  matchTrainingPattern
};
