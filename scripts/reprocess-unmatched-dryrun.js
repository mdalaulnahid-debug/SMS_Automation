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
// PERFORMANCE HISTORY (2026-08-02):
//   v1 called AutomationService.rankReplyCandidates() in a loop, once per
//   unmatched row. That method re-sorts the ENTIRE request table
//   (O(R log R)) and does an O(S) linear scan of the full outbox for every
//   candidate it considers — crashed the VPS (1 vCPU/1GB) on ~8,500 rows.
//   v2 indexed requests by gateway once up front, but still re-parsed each
//   candidate's createdAt timestamp with `new Date(...).getTime()` on every
//   single row x candidate comparison, and scanned a gateway's ENTIRE
//   history for every row instead of stopping once past the lookback
//   window — with months of accumulated data this was still tens/hundreds
//   of millions of Date parses and likely still resource-heavy enough to
//   hang or crash the box.
//   v3 (this version): precomputes each request's createdAt as a plain
//   number ONCE, and sorts each gateway's candidate list once by that
//   number (descending, matching store.listRequests() order) so the
//   per-row scan can BREAK as soon as it passes the lookback cutoff
//   instead of scanning the gateway's full history every time. Also logs
//   progress every 500 rows so a slow run is visible instead of silent.
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

// Build once: requestId -> request, requestId -> createdAt as a plain
// number (parsed exactly once, never re-parsed per comparison), and
// gatewayId -> requestIds sorted newest-first so per-row scans can break
// early instead of walking a gateway's entire history every time.
const requestsById = new Map();
const createdAtMsById = new Map();
for (const request of store.listRequests()) {
  requestsById.set(request.requestId, request);
  createdAtMsById.set(request.requestId, new Date(request.createdAt).getTime());
}

const gatewayToRequestIds = new Map();
for (const row of store.smsOutbox) {
  if (row.sentStatus === 'FAILED') continue;
  if (!requestsById.has(row.requestId)) continue;
  if (!gatewayToRequestIds.has(row.gatewayId)) gatewayToRequestIds.set(row.gatewayId, new Set());
  gatewayToRequestIds.get(row.gatewayId).add(row.requestId);
}
for (const [gatewayId, idSet] of gatewayToRequestIds) {
  const sorted = [...idSet].sort((a, b) => createdAtMsById.get(b) - createdAtMsById.get(a));
  gatewayToRequestIds.set(gatewayId, sorted);
}

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function rankCandidates(row) {
  const operatorKey = store.operatorForGateway(row.gatewayId);
  const inferredReplyFamilies = inferReplyFamilies(row.messageBody, operatorKey || '');
  const cutoff = new Date(row.receivedAt).getTime() - LOOKBACK_MS;
  const requestIds = gatewayToRequestIds.get(row.gatewayId);
  if (!requestIds || requestIds.length === 0) return [];

  const ranked = [];
  for (const requestId of requestIds) {
    const createdAtMs = createdAtMsById.get(requestId);
    if (createdAtMs < cutoff) break; // sorted newest-first: nothing further can qualify

    const request = requestsById.get(requestId);
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

  ranked.sort((a, b) => b.score - a.score || createdAtMsById.get(b.requestId) - createdAtMsById.get(a.requestId));
  return ranked;
}

const resolvable = [];
const noCandidate = [];
const stillAmbiguous = [];

const startedAt = Date.now();
for (let i = 0; i < genuineLooking.length; i++) {
  const row = genuineLooking[i];
  const ranked = rankCandidates(row);
  if (!ranked.length) {
    noCandidate.push(row);
  } else {
    const [top, second] = ranked;
    const confident = top.score > 0 && top.typeScore >= 0 && top.confidence !== 'UNKNOWN' && (!second || top.score > second.score);
    if (confident) {
      resolvable.push({ row, top });
    } else {
      stillAmbiguous.push(row);
    }
  }

  if ((i + 1) % 500 === 0 || i === genuineLooking.length - 1) {
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`  ...processed ${i + 1}/${genuineLooking.length} (${elapsedSec}s elapsed)`);
  }
}

console.log(`\nWould now resolve to a single confident candidate: ${resolvable.length}`);
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
