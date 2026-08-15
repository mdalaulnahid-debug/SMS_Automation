'use strict';

const { REQUEST_TYPES } = require('./domain');
const { extractSilentReference } = require('./store');
const { matchReplyAgainstTraining, scoreReplyFamiliesFromTraining } = require('./trainingData');

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
    /no\s+data\s+found[^\n]*\bnid\b/i,
    // Unanchored fallback: "Sorry No records found for NID: ..." embeds the keyword
    // mid-sentence, so the line-start anchors above never fire for that template.
    /\bnid\s*:\s*\d{6,}/i,
    /no\s+records?\s+found\s+for\s+nid\b/i
  ],
  [REQUEST_TYPES.IMEI_MS]: [
    /(?:^|\n)\s*imei[:\s]/i,
    /\bmsisdn-date\b/i,
    /no\s+data\s+available\s+within\s+90\s+days/i,
    /(?:^|\n)\s*\d{14,15},\s*8801\d{9},\s*\d{8}/i,
    // Unanchored fallback: GP's "no records found" template embeds "IMEI:" mid-sentence
    // (e.g. "Sorry No records found for IMEI: 353917104327090 [GP]"), so the line-start
    // anchors above never fire for it — without this, the reply scores as type-neutral
    // and can get matched onto an unrelated pending request (e.g. an LRL query).
    /\bimei\s*:\s*\d{6,}/i,
    /no\s+records?\s+found\s+for\s+imei\b/i
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
  const inferredReplyFamilies = inferReplyFamilies(body, request.operator);
  // STRONG_REPLY_FAMILY_PATTERNS (used by inferReplyFamilies) is a much more
  // complete catalog of real operator reply templates than REPLY_PATTERNS
  // above (e.g. "no rl info found", "lastactivedatetime", "moc/mtc/smsmt")
  // — inferredReplyFamilies was already being computed here but its result
  // never fed back into patternMatched/confidence, so a reply the system
  // had *already correctly classified* as this request's type could still
  // score as patternMatched=false and fall to UNKNOWN confidence. Real-world
  // impact: on a gateway with multiple simultaneous open requests, the
  // auto-matcher requires confidence > 0 to ever pick a candidate — this
  // silently orphaned a large share of genuine replies into the unmatched
  // queue instead of matching them (2026-08-02 investigation).
  const strongTypeMatch = inferredReplyFamilies.strongTypes.includes(request.requestType);
  const patternMatched = matchedPatterns.length > 0 || trainingMatch.matched || strongTypeMatch;

  return {
    requestType: request.requestType,
    referenceMatched: Boolean(foundReference && foundReference === request.silentReference),
    foundReference,
    payloadMatched: payloadMatch.matched,
    payloadMatchCount: payloadMatch.count,
    payloadMatches: payloadMatch.identifiers,
    patternMatched,
    matchedPatterns,
    trainingMatch,
    inferredReplyFamilies,
    confidence: confidenceScore({
      referenceMatched: Boolean(foundReference && foundReference === request.silentReference),
      payloadMatched: payloadMatch.matched,
      patternMatched
    })
  };
}

function inferReplyFamilies(messageBody, operator = '') {
  const body = String(messageBody || '');
  const strongTypes = [];
  for (const [requestType, patterns] of Object.entries(STRONG_REPLY_FAMILY_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(body))) strongTypes.push(requestType);
  }
  const trainingScores = scoreReplyFamiliesFromTraining(body, operator);
  const trainingTypes = [];
  if (trainingScores.length) {
    const top = trainingScores[0];
    const second = trainingScores[1];
    if (top.score >= 2 && (!second || top.score > second.score)) {
      trainingTypes.push(top.requestType);
    }
  }
  return {
    strongTypes: [...new Set(strongTypes)],
    trainingTypes
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

// ── Content gate ──────────────────────────────────────────────────────────
// Identifiers an operator reply is expected to echo, per request type. Used to
// REJECT a reply whose echoed identifiers are disjoint from the request's payload
// (the 2026-07-05 blackout cross-matched IMEI replies onto the wrong request
// because the matcher only checked gateway + sender + time window, never content).
// Only gated types are checked; MS-NID is intentionally omitted (bare NID digit
// runs are too ambiguous to gate safely).
const REPLY_IDENTIFIER_EXTRACTORS = Object.freeze({
  [REQUEST_TYPES.IMEI_MS]: (body) => body.match(/\b\d{14,15}\b/g) || [],
  [REQUEST_TYPES.NID_MS]: (body) => body.match(/\b(?:8801|01)\d{8,9}\b/g) || [],
  [REQUEST_TYPES.LRL]: (body) => body.match(/\b(?:8801|01)\d{8,9}\b/g) || [],
  [REQUEST_TYPES.LCL]: (body) => body.match(/\b(?:8801|01)\d{8,9}\b/g) || []
});

function stripMsisdnPrefix(digits) {
  return String(digits).replace(/^(?:\+?880|0)/, '');
}

// True when the reply clearly echoes identifiers of the request's type but NONE
// of them match the request's payload — a strong signal the reply belongs to a
// different request and must not be auto-attached. Returns false (no opinion)
// for untracked types or replies that echo no identifiers (e.g. bare "no data"),
// preserving the existing type+timing behavior for those.
function replyContradictsPayload(request, messageBody) {
  const extractor = REPLY_IDENTIFIER_EXTRACTORS[request.requestType];
  if (!extractor) return false;
  const body = String(messageBody || '');
  const echoed = extractor(body).map((d) => d.replace(/[\s\-().]/g, ''));
  if (echoed.length === 0) return false;
  const payloadIds = String(request.payload || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((d) => d.replace(/[\s\-().]/g, ''));
  const payloadSet = new Set();
  for (const id of payloadIds) {
    payloadSet.add(id);
    payloadSet.add(stripMsisdnPrefix(id));
  }
  const anyOverlap = echoed.some((e) => payloadSet.has(e) || payloadSet.has(stripMsisdnPrefix(e)));
  return !anyOverlap;
}

function matchTrainingPattern(request, body) {
  return matchReplyAgainstTraining({
    requestType: request.requestType,
    operator: request.operator,
    messageBody: body
  });
}

function confidenceScore({ referenceMatched, payloadMatched, patternMatched }) {
  if (referenceMatched) return 'HIGH';
  if (payloadMatched && patternMatched) return 'HIGH';
  if (payloadMatched) return 'MEDIUM';
  if (patternMatched) return 'LOW';
  return 'UNKNOWN';
}

module.exports = {
  REPLY_PATTERNS,
  analyzeOperatorReply,
  inferReplyFamilies,
  matchTrainingPattern,
  replyContradictsPayload
};
