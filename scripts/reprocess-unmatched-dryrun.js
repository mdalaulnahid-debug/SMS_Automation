#!/usr/bin/env node
'use strict';

// DRY RUN ONLY — reports what the now-fixed matching logic (2026-08-02
// patternMatched fix) would resolve against the existing unmatched backlog.
// Writes NOTHING to the database. Reuses the exact same scoring the live
// auto-matcher uses (analyzeOperatorReply + replyTypeScore + confidenceRank,
// imported straight from src/) — so this can't drift from what the live
// system actually considers a match; it's just applying that same signal in
// bulk instead of one row at a time by hand.
//
// Deliberately does NOT auto-apply anything: many of these requests are
// long since COMPLETED/TIMEOUT/FAILED, and blindly re-attaching a reply
// (which can trigger a reply draft, or auto-post depending on channel
// config) to a months-old, possibly-forgotten investigative request is a
// real-world decision, not something to automate. This script's only job
// is to tell you how big that decision actually is.
//
// PERFORMANCE HISTORY:
//   v1-v3 all scored EVERY candidate request within a fixed lookback
//   window (e.g. 30 days before the reply) using the full, expensive
//   analyzeOperatorReply() -- regex pattern matching plus a training-data
//   scan per candidate. That's fine for *current* traffic, where most of a
//   gateway's history sits outside the window and gets skipped cheaply.
//   It's catastrophic for OLD backlog rows: this system's data only goes
//   back to when it launched, so "30 days before a June row" covers almost
//   the entire dataset -- nearly every request ever dispatched to that
//   gateway got the full expensive scoring treatment, for every one of
//   thousands of unmatched rows. Confirmed live: 83% CPU for 29+ minutes
//   with zero progress on the very first 500-row checkpoint.
//
//   v4 (this version) takes the same approach correlate-unmatched.js
//   already uses successfully against this exact dataset: first cheaply
//   narrow candidates down to only requests actually still OPEN (dispatched
//   before the reply arrived, not yet replied to) at the moment the reply
//   showed up -- plain date comparisons against request_dispatches, no
//   regex or training-data work at all. Only THAT small set (typically 1-3
//   requests, never a gateway's entire history) gets the expensive real
//   scoring. This mirrors what correlate-unmatched.js already found: 86%
//   of the backlog has 2 open candidates at once, not hundreds.
//
// Run on the server:
//   node scripts/reprocess-unmatched-dryrun.js

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { inferReplyFamilies, analyzeOperatorReply } = require('../src/replyAnalyzer');
const { confidenceRank, replyTypeScore } = require('../src/service');

const dbPath = process.env.SMS_DB_PATH || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;'); // wait briefly instead of erroring if the live server holds the lock

// Excludes rows the system itself already flagged as ignored (untrusted
// sender for that gateway -- see service.js's SMS_IGNORED_UNTRUSTED_SENDER).
// Matches buildAdminData's real Unmatched SMS filter in src/app.js.
const unmatched = db.prepare(`
  SELECT id, gateway_id, message_body, received_at
  FROM sms_inbox
  WHERE matched_request_id IS NULL
    AND (analysis IS NULL OR analysis NOT LIKE '%"ignored":true%')
`).all();

const genuineLooking = unmatched.filter(
  (row) => inferReplyFamilies(row.message_body || '', '').strongTypes.length > 0
);

console.log(`Unmatched total: ${unmatched.length}`);
console.log(`Looks like a genuine reply (worth checking): ${genuineLooking.length}\n`);

// One SQL fetch per gateway (there are only ever a handful of gateways
// total), same dispatchesFor() pattern already proven fast by
// correlate-unmatched.js against this exact dataset.
const dispatchesByGateway = new Map();
function dispatchesFor(gatewayId) {
  if (!dispatchesByGateway.has(gatewayId)) {
    const rows = db.prepare(`
      SELECT rd.request_id, rd.sent_at, rd.replied_at,
             r.status, r.request_type, r.payload, r.operator, r.created_at
      FROM request_dispatches rd
      JOIN requests r ON r.request_id = rd.request_id
      WHERE rd.gateway_id = ? AND rd.sent_at IS NOT NULL
      ORDER BY rd.sent_at
    `).all(gatewayId);
    dispatchesByGateway.set(gatewayId, rows);
  }
  return dispatchesByGateway.get(gatewayId);
}

const resolvable = [];
const noCandidate = [];
const stillAmbiguous = [];

const startedAt = Date.now();
for (let i = 0; i < genuineLooking.length; i++) {
  const row = genuineLooking[i];
  const replyTime = new Date(row.received_at).getTime();

  // Cheap filter: only dispatches to this gateway sent before the reply
  // arrived, AND still open (no reply recorded yet) at that moment. Plain
  // date comparisons -- no regex, no training-data lookups.
  const openCandidates = dispatchesFor(row.gateway_id).filter((d) => {
    const sentAt = new Date(d.sent_at).getTime();
    if (sentAt > replyTime) return false;
    if (!d.replied_at) return true;
    return new Date(d.replied_at).getTime() > replyTime;
  });

  if (!openCandidates.length) {
    noCandidate.push(row);
    if ((i + 1) % 500 === 0 || i === genuineLooking.length - 1) {
      console.log(`  ...processed ${i + 1}/${genuineLooking.length} (${((Date.now() - startedAt) / 1000).toFixed(1)}s elapsed)`);
    }
    continue;
  }

  // Only now run the real, expensive scoring -- and only on this small
  // pre-filtered set, never the gateway's entire request history.
  const operatorKey = openCandidates[0].operator;
  const inferredReplyFamilies = inferReplyFamilies(row.message_body, operatorKey);
  const ranked = openCandidates
    .map((d) => {
      const request = {
        requestId: d.request_id,
        requestType: d.request_type,
        payload: d.payload,
        operator: d.operator,
        status: d.status,
        createdAt: d.created_at
      };
      const analysis = analyzeOperatorReply({ request, messageBody: row.message_body });
      const typeScore = replyTypeScore(request, inferredReplyFamilies);
      const score = (typeScore * 100)
        + (confidenceRank(analysis.confidence) * 10)
        + (analysis.payloadMatchCount || 0) * 5
        + (analysis.trainingMatch?.score || 0);
      return { requestId: d.request_id, requestType: d.request_type, status: d.status, createdAt: d.created_at, score, typeScore, confidence: analysis.confidence };
    })
    .sort((a, b) => b.score - a.score || new Date(b.createdAt) - new Date(a.createdAt));

  const [top, second] = ranked;
  const confident = top.score > 0 && top.typeScore >= 0 && top.confidence !== 'UNKNOWN' && (!second || top.score > second.score);
  if (confident) {
    resolvable.push({ row, top });
  } else {
    stillAmbiguous.push(row);
  }

  if ((i + 1) % 500 === 0 || i === genuineLooking.length - 1) {
    console.log(`  ...processed ${i + 1}/${genuineLooking.length} (${((Date.now() - startedAt) / 1000).toFixed(1)}s elapsed)`);
  }
}

console.log(`\nWould now resolve to a single confident candidate: ${resolvable.length}`);
console.log(`No candidate request found at all (nothing open on that gateway when the reply arrived): ${noCandidate.length}`);
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
  console.log(`  inbox ${row.id} [${row.gateway_id}] ${row.received_at} -> request ${top.requestId} (${top.requestType}, ${top.status}, confidence=${top.confidence}, score=${top.score})`);
  console.log(`    ${(row.message_body || '').slice(0, 80).replace(/\n/g, ' \\n ')}`);
}
