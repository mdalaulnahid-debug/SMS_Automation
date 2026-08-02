#!/usr/bin/env node
'use strict';

// DRY RUN ONLY — reports what the now-fixed matching logic (2026-08-02
// patternMatched fix) would resolve against the existing unmatched backlog.
// Writes NOTHING to the database. Reuses the exact same scoring the live
// auto-matcher/rankReplyCandidates() uses (analyzeOperatorReply +
// replyTypeScore + confidenceRank, imported from src/service.js) — so this
// can't drift from what the live system actually considers a match; it's
// just applying that same signal in bulk instead of one row at a time.
//
// Deliberately does NOT auto-apply anything: many of these requests are
// long since COMPLETED/TIMEOUT/FAILED, and blindly re-attaching a reply
// (which can trigger a reply draft, or auto-post depending on channel
// config) to a months-old, possibly-forgotten investigative request is a
// real-world decision, not something to automate. This script's only job
// is to tell you how big that decision actually is.
//
// PERFORMANCE NOTE (2026-08-02): the first version of this script called
// AutomationService.rankReplyCandidates() in a loop, once per unmatched
// row. That method internally re-sorts the ENTIRE request table
// (store.listRequests(), O(R log R)) and does an O(S) linear scan of the
// full SMS outbox (store.getOutboxForGateway()) for every candidate it
// considers — fine for a single manual lookup, but on ~8,500 rows against
// months of production data it caused a resource-exhaustion crash on the
// VPS's 1 vCPU/1GB box. This version builds the same lookups ONCE up
// front (an index of requests-by-gateway from a single pass over the
// outbox table) and reuses them for every row, instead of re-deriving
// candidate lists from scratch thousands of times.
//
// Run on the server:
//   node scripts/reprocess-unmatched-dryrun.js

const path = require('node:path');
const { AutomationStore } = require('../src/store');
const { inferReplyFamilies, analyzeOperatorReply } = require('../src/replyAnalyzer');
const { confidenceRank, replyTypeScore } = require('../src/service');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const store = new AutomationStore({}, { dbPath });

const unmatched = store.smsInbox.filter((row) => !row.matchedRequestId);
const genuineLooking = unmatched.filter(
  (row) => inferReplyFamilies(row.messageBody || '', store.operatorForGateway(row.gatewayId) || '').strongTypes.length > 0
);

console.log(`Unmatched total: ${unmatched.length}`);
console.log(`Looks like a genuine reply (worth checking): ${genuineLooking.length}\n`);

// Build once: requestId -> request, and gatewayId -> [requestId, ...] from a
// single pass over the outbox, instead of re-scanning per unmatched row.
const requestsById = new Map(store.listRequests().map((request) => [request.requestId, request]));
const gatewayToRequestIds = new Map();
for (const row of store.smsOutbox) {
  if (row.sentStatus === 'FAILED') continue;
  if (!gatewayToRequestIds.has(row.gatewayId)) gatewayToRequestIds.set(row.gatewayId, new Set());
  gatewayToRequestIds.get(row.gatewayId).add(row.requestId);
}

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function rankCandidates(row) {
  const operatorKey = store.operatorForGateway(row.gatewayId);
  const inferredReplyFamilies = inferReplyFamilies(row.messageBody, operatorKey || '');
  const cutoff = new Date(row.receivedAt).getTime() - LOOKBACK_MS;
  const requestIds = gatewayToRequestIds.get(row.gatewayId);
  if (!requestIds || requestIds.size === 0) return [];

  const ranked = [];
  for (const requestId of requestIds) {
    const request = requestsById.get(requestId);
    if (!request) continue;
    if (new Date(request.createdAt).getTime() < cutoff) continue;

    const analysis = analyzeOperatorReply({ request, messageBody: row.messageBody });
    const typeScore = replyTypeScore(request, inferredReplyFamilies);
    const score = (typeScore * 100)
      + (confidenceRank(analysis.confidence) * 10)
      + (analysis.payloadMatchCount || 0) * 5
      + (analysis.trainingMatch?.score || 0);
    ranked.push({
      requestId: request.requestId,
      requestType: request.requestType,
      status: request.status,
      createdAt: request.createdAt,
      score,
      typeScore,
      confidence: analysis.confidence
    });
  }

  ranked.sort((a, b) => b.score - a.score || new Date(b.createdAt) - new Date(a.createdAt));
  return ranked;
}

const resolvable = [];
const noCandidate = [];
const stillAmbiguous = [];

for (const row of genuineLooking) {
  const ranked = rankCandidates(row);
  if (!ranked.length) {
    noCandidate.push(row);
    continue;
  }
  const [top, second] = ranked;
  const confident = top.score > 0 && top.typeScore >= 0 && top.confidence !== 'UNKNOWN' && (!second || top.score > second.score);
  if (confident) {
    resolvable.push({ row, top });
  } else {
    stillAmbiguous.push(row);
  }
}

console.log(`Would now resolve to a single confident candidate: ${resolvable.length}`);
console.log(`No candidate request found at all (even with 30-day lookback): ${noCandidate.length}`);
console.log(`Still ambiguous / not confident even with the fix: ${stillAmbiguous.length}\n`);

console.log('--- Resolvable, by target request\'s CURRENT status ---');
const byStatus = {};
for (const { top } of resolvable) byStatus[top.status] = (byStatus[top.status] || 0) + 1;
for (const [status, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${status}: ${n}`);
}
console.log('  (COMPLETED/TIMEOUT/FAILED means the request was already resolved another way —');
console.log('   attaching this reply now would be historical record-keeping, not a live answer.');
console.log('   WAITING_OPERATOR_REPLY / NEEDS_MANUAL_REVIEW means it may still be relevant today.)');

console.log('\n--- 8 samples of resolvable matches ---');
for (const { row, top } of resolvable.slice(0, 8)) {
  console.log(`  inbox ${row.id} [${row.gatewayId}] ${row.receivedAt} -> request ${top.requestId} (${top.requestType}, ${top.status}, confidence=${top.confidence}, score=${top.score})`);
  console.log(`    ${(row.messageBody || '').slice(0, 80).replace(/\n/g, ' \\n ')}`);
}
