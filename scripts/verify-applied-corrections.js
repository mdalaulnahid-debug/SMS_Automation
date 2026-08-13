#!/usr/bin/env node
'use strict';

// Read-only. Audits every correction already applied by
// apply-historical-corrections.js (found via its BACKLOG_MATCH_CORRECTED
// audit log entries) against the CORRECTED candidate logic -- the earlier
// version of these scripts treated any never-replied dispatch as "open"
// indefinitely instead of bounding it by the real reply window
// (DEFAULT_REPLY_WINDOW_MS, 15 min), which inflated candidate pools with
// stale, already-timed-out requests.
//
// For each applied correction, re-derives what the CORRECTED logic would
// choose today (as if the match had never been applied) and compares it
// to what was actually written. Reports:
//   - AGREES: corrected logic picks the same request -- no problem.
//   - DISAGREES: corrected logic picks a DIFFERENT request, or now says
//     "no confident candidate" -- worth a manual look, possibly a wrong
//     match that should be reversed.
//
// Run on the server:
//   node scripts/verify-applied-corrections.js

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { inferReplyFamilies, analyzeOperatorReply } = require('../src/replyAnalyzer');
const { confidenceRank, replyTypeScore, DEFAULT_REPLY_WINDOW_MS } = require('../src/service');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');

const appliedLogs = db.prepare(`
  SELECT id, request_id, details, timestamp
  FROM audit_logs
  WHERE action = 'BACKLOG_MATCH_CORRECTED'
  ORDER BY timestamp
`).all();

console.log(`Found ${appliedLogs.length} previously-applied backlog corrections to verify.\n`);

if (!appliedLogs.length) {
  console.log('Nothing to verify.');
  process.exit(0);
}

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

let agrees = 0;
let disagrees = 0;
const disagreements = [];

for (let i = 0; i < appliedLogs.length; i++) {
  const log = appliedLogs[i];
  let details;
  try {
    details = JSON.parse(log.details || '{}');
  } catch {
    details = {};
  }
  const inboxId = details.inboxId;
  const appliedRequestId = log.request_id;
  if (!inboxId || !appliedRequestId) continue;

  const inbox = db.prepare('SELECT gateway_id, message_body, received_at FROM sms_inbox WHERE id = ?').get(inboxId);
  if (!inbox) continue;

  const replyTime = new Date(inbox.received_at).getTime();
  const openCandidates = dispatchesFor(inbox.gateway_id).filter((d) => {
    const sentAt = new Date(d.sent_at).getTime();
    if (sentAt > replyTime) return false;
    if (sentAt + DEFAULT_REPLY_WINDOW_MS < replyTime) return false;
    if (!d.replied_at) return true;
    return new Date(d.replied_at).getTime() > replyTime;
  });

  let correctedTop = null;
  if (openCandidates.length) {
    const operatorKey = openCandidates[0].operator;
    const inferredReplyFamilies = inferReplyFamilies(inbox.message_body, operatorKey);
    const ranked = openCandidates
      .map((d) => {
        const request = { requestId: d.request_id, requestType: d.request_type, payload: d.payload, operator: d.operator, status: d.status, createdAt: d.created_at };
        const analysis = analyzeOperatorReply({ request, messageBody: inbox.message_body });
        const typeScore = replyTypeScore(request, inferredReplyFamilies);
        const score = (typeScore * 100)
          + (confidenceRank(analysis.confidence) * 10)
          + (analysis.payloadMatchCount || 0) * 5
          + (analysis.trainingMatch?.score || 0);
        return { requestId: d.request_id, score, typeScore, confidence: analysis.confidence };
      })
      .sort((a, b) => b.score - a.score);
    const [top, second] = ranked;
    const confident = top.score > 0 && top.typeScore >= 0 && top.confidence !== 'UNKNOWN' && (!second || top.score > second.score);
    correctedTop = confident ? top.requestId : null;
  }

  if (correctedTop === appliedRequestId) {
    agrees++;
  } else {
    disagrees++;
    disagreements.push({ inboxId, appliedRequestId, correctedTop, receivedAt: inbox.received_at, gatewayId: inbox.gateway_id });
  }

  if ((i + 1) % 500 === 0 || i === appliedLogs.length - 1) {
    console.log(`  ...verified ${i + 1}/${appliedLogs.length}`);
  }
}

console.log(`\nAgrees with the corrected logic: ${agrees}`);
console.log(`Disagrees (worth a manual look): ${disagrees}\n`);

if (disagreements.length) {
  console.log('--- Disagreements ---');
  for (const d of disagreements.slice(0, 30)) {
    console.log(`  inbox ${d.inboxId} [${d.gatewayId}] @ ${d.receivedAt}`);
    console.log(`    applied: ${d.appliedRequestId}  |  corrected logic says: ${d.correctedTop || '(no confident candidate)'}`);
  }
  if (disagreements.length > 30) {
    console.log(`  ...and ${disagreements.length - 30} more`);
  }
}
