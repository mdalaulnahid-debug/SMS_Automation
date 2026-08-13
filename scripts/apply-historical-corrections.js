#!/usr/bin/env node
'use strict';

// Applies DATABASE-ONLY corrections for the historical unmatched backlog.
// For every unmatched inbox row that confidently resolves to an
// already-finalized request (TIMEOUT/COMPLETED/FAILED), this sets
// sms_inbox.matched_request_id directly. That's it -- no reply draft is
// created, no request/dispatch status changes, and nothing is posted
// anywhere (Telegram autoApprove is irrelevant here because service.js's
// correctMatch()/manualMatch() -- which DO create reply drafts and can
// auto-post -- are never called).
//
// Deliberately EXCLUDES any match whose target request is still
// WAITING_OPERATOR_REPLY or NEEDS_MANUAL_REVIEW: those are live, and
// should go through the normal Exception Desk / manual-match UI instead
// (POST /api/manual-match), which correctly creates a reply draft and can
// notify the requester -- something you DO want for a request that's
// still actually pending, unlike a months-old already-finalized one.
//
// Same identification approach as reprocess-unmatched-dryrun.js: cheap
// SQL-first filter to candidates genuinely open on the gateway when the
// reply arrived, then real scoring only on that small set.
//
// Usage:
//   node scripts/apply-historical-corrections.js            # dry run, shows what would change
//   node scripts/apply-historical-corrections.js --apply    # actually writes

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { AutomationStore } = require('../src/store');
const { inferReplyFamilies, analyzeOperatorReply } = require('../src/replyAnalyzer');
const { confidenceRank, replyTypeScore } = require('../src/service');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const apply = process.argv.includes('--apply');

// --- Identification pass (read-only, raw SQL) ---
const db = new DatabaseSync(dbPath);
const unmatched = db.prepare(`SELECT id, gateway_id, message_body, received_at FROM sms_inbox WHERE matched_request_id IS NULL`).all();
const genuineLooking = unmatched.filter((row) => inferReplyFamilies(row.message_body || '', '').strongTypes.length > 0);

const dispatchesByGateway = new Map();
function dispatchesFor(gatewayId) {
  if (!dispatchesByGateway.has(gatewayId)) {
    dispatchesByGateway.set(gatewayId, db.prepare(`
      SELECT rd.request_id, rd.sent_at, rd.replied_at,
             r.status, r.request_type, r.payload, r.operator, r.created_at
      FROM request_dispatches rd
      JOIN requests r ON r.request_id = rd.request_id
      WHERE rd.gateway_id = ? AND rd.sent_at IS NOT NULL
      ORDER BY rd.sent_at
    `).all(gatewayId));
  }
  return dispatchesByGateway.get(gatewayId);
}

const LIVE_STATUSES = new Set(['WAITING_OPERATOR_REPLY', 'NEEDS_MANUAL_REVIEW']);
const toApply = [];
let skippedLive = 0;
let stillAmbiguous = 0;
let noCandidate = 0;

console.log(`Scanning ${genuineLooking.length} genuine-looking unmatched rows (same identification pass as reprocess-unmatched-dryrun.js -- takes a few minutes)...`);
const identifyStartedAt = Date.now();

for (let i = 0; i < genuineLooking.length; i++) {
  const row = genuineLooking[i];
  const replyTime = new Date(row.received_at).getTime();
  const openCandidates = dispatchesFor(row.gateway_id).filter((d) => {
    const sentAt = new Date(d.sent_at).getTime();
    if (sentAt > replyTime) return false;
    if (!d.replied_at) return true;
    return new Date(d.replied_at).getTime() > replyTime;
  });

  if (!openCandidates.length) {
    noCandidate++;
  } else {
    const operatorKey = openCandidates[0].operator;
    const inferredReplyFamilies = inferReplyFamilies(row.message_body, operatorKey);
    const ranked = openCandidates
      .map((d) => {
        const request = { requestId: d.request_id, requestType: d.request_type, payload: d.payload, operator: d.operator, status: d.status, createdAt: d.created_at };
        const analysis = analyzeOperatorReply({ request, messageBody: row.message_body });
        const typeScore = replyTypeScore(request, inferredReplyFamilies);
        const score = (typeScore * 100)
          + (confidenceRank(analysis.confidence) * 10)
          + (analysis.payloadMatchCount || 0) * 5
          + (analysis.trainingMatch?.score || 0);
        return { requestId: d.request_id, status: d.status, score, typeScore, confidence: analysis.confidence };
      })
      .sort((a, b) => b.score - a.score);

    const [top, second] = ranked;
    const confident = top.score > 0 && top.typeScore >= 0 && top.confidence !== 'UNKNOWN' && (!second || top.score > second.score);
    if (!confident) {
      stillAmbiguous++;
    } else if (LIVE_STATUSES.has(top.status)) {
      skippedLive++;
    } else {
      toApply.push({ inboxId: row.id, requestId: top.requestId, status: top.status });
    }
  }

  if ((i + 1) % 500 === 0 || i === genuineLooking.length - 1) {
    console.log(`  ...scanned ${i + 1}/${genuineLooking.length} (${((Date.now() - identifyStartedAt) / 1000).toFixed(1)}s elapsed)`);
  }
}
db.close();
console.log('');

const byStatus = {};
for (const { status } of toApply) byStatus[status] = (byStatus[status] || 0) + 1;

console.log(`Genuine-looking unmatched rows scanned: ${genuineLooking.length}`);
console.log(`Database-only corrections to apply (target already finalized): ${toApply.length}`);
for (const [status, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${status}: ${n}`);
}
console.log(`Skipped -- target is still LIVE (use the Exception Desk UI instead): ${skippedLive}`);
console.log(`No candidate open on that gateway: ${noCandidate}`);
console.log(`Still ambiguous: ${stillAmbiguous}\n`);

if (!apply) {
  console.log('Dry run only -- nothing written. Re-run with --apply to write these corrections.');
  process.exit(0);
}

console.log('--apply passed -- writing database-only corrections (no reply drafts, nothing posted anywhere)...');
const store = new AutomationStore({}, { dbPath });
const inboxById = new Map(store.smsInbox.map((r) => [r.id, r])); // avoid an O(n) find() per correction
let applied = 0;
let alreadyMatched = 0;
const applyStartedAt = Date.now();
for (let i = 0; i < toApply.length; i++) {
  const { inboxId, requestId } = toApply[i];
  const inbox = inboxById.get(inboxId);
  if (!inbox || inbox.matchedRequestId) {
    alreadyMatched++;
  } else {
    inbox.matchedRequestId = requestId;
    if (store.persistence) store.persistence.insertInbox(inbox);
    store.audit('system', 'BACKLOG_MATCH_CORRECTED', requestId, {
      inboxId,
      note: 'Database-only correction via scripts/apply-historical-corrections.js -- no reply draft created, nothing posted to Telegram.'
    });
    applied++;
  }
  if ((i + 1) % 500 === 0 || i === toApply.length - 1) {
    console.log(`  ...applied ${i + 1}/${toApply.length} (${((Date.now() - applyStartedAt) / 1000).toFixed(1)}s elapsed)`);
  }
}
console.log(`\nApplied ${applied} corrections. (${alreadyMatched} were already matched by the time this ran, skipped.)`);
