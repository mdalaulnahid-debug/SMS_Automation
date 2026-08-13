#!/usr/bin/env node
'use strict';

// Read-only. For each unmatched sms_inbox row that LOOKS like a genuine
// reply (per replyAnalyzer's inferReplyFamilies), finds the most recent
// dispatch sent to the same gateway before the reply arrived, and reports:
//   - how long after that dispatch the reply showed up (latency)
//   - what status that request was in AT THE TIME the reply arrived
//   - whether more than one dispatch was in flight on that gateway at once
// This distinguishes "the matcher has a real bug" (a plausible request
// existed, reply just didn't attach) from "nothing to match at all" (no
// dispatch happened near this reply — unrelated to any request this
// system sent).
//
// Run on the server:
//   node scripts/correlate-unmatched.js

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { inferReplyFamilies } = require('../src/replyAnalyzer');

const dbPath = process.env.SMS_DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
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

const genuineLooking = unmatched.filter((row) => inferReplyFamilies(row.message_body || '', '').strongTypes.length > 0);

console.log(`Analyzing ${genuineLooking.length} genuine-looking unmatched replies...\n`);

const dispatchesByGateway = new Map();
function dispatchesFor(gatewayId) {
  if (!dispatchesByGateway.has(gatewayId)) {
    const rows = db.prepare(`
      SELECT rd.request_id, rd.sent_at, rd.replied_at, r.status, r.request_type, r.created_at, r.completed_at
      FROM request_dispatches rd
      JOIN requests r ON r.request_id = rd.request_id
      WHERE rd.gateway_id = ? AND rd.sent_at IS NOT NULL
      ORDER BY rd.sent_at
    `).all(gatewayId);
    dispatchesByGateway.set(gatewayId, rows);
  }
  return dispatchesByGateway.get(gatewayId);
}

const buckets = { noDispatchNearby: 0, lateArrivalAfterResolved: 0, ambiguousMultipleOpen: 0, plausibleButUnexplained: 0 };
const examples = { noDispatchNearby: [], lateArrivalAfterResolved: [], ambiguousMultipleOpen: [], plausibleButUnexplained: [] };
const latenciesMs = [];

for (const row of genuineLooking) {
  const replyTime = new Date(row.received_at).getTime();
  const candidates = dispatchesFor(row.gateway_id).filter((d) => new Date(d.sent_at).getTime() <= replyTime);

  if (candidates.length === 0) {
    buckets.noDispatchNearby++;
    if (examples.noDispatchNearby.length < 3) examples.noDispatchNearby.push(row);
    continue;
  }

  const nearest = candidates[candidates.length - 1];
  const latency = replyTime - new Date(nearest.sent_at).getTime();
  latenciesMs.push(latency);

  const openAtReplyTime = candidates.filter((d) => {
    if (!d.replied_at) return true;
    return new Date(d.replied_at).getTime() > replyTime;
  });

  if (openAtReplyTime.length > 1) {
    buckets.ambiguousMultipleOpen++;
    if (examples.ambiguousMultipleOpen.length < 3) {
      examples.ambiguousMultipleOpen.push({ ...row, openCount: openAtReplyTime.length, latencyMin: Math.round(latency / 60000) });
    }
    continue;
  }

  const terminalStatuses = ['REPLY_POSTED', 'FAILED', 'QUEUED'];
  if (terminalStatuses.includes(nearest.status) || (nearest.completed_at && new Date(nearest.completed_at).getTime() < replyTime)) {
    buckets.lateArrivalAfterResolved++;
    if (examples.lateArrivalAfterResolved.length < 3) {
      examples.lateArrivalAfterResolved.push({ ...row, requestStatus: nearest.status, latencyMin: Math.round(latency / 60000) });
    }
    continue;
  }

  buckets.plausibleButUnexplained++;
  if (examples.plausibleButUnexplained.length < 3) {
    examples.plausibleButUnexplained.push({ ...row, requestStatus: nearest.status, latencyMin: Math.round(latency / 60000) });
  }
}

console.log(`No dispatch at all before this reply on that gateway: ${buckets.noDispatchNearby}`);
console.log(`  (arrived with nothing this system ever sent to explain it)`);
console.log(`Reply arrived after the nearest request already resolved/gave up: ${buckets.lateArrivalAfterResolved}`);
console.log(`  (operator reply latency exceeded whatever window the matcher allows)`);
console.log(`Multiple requests were open on the same gateway at once: ${buckets.ambiguousMultipleOpen}`);
console.log(`  (matcher may be refusing to guess between them)`);
console.log(`Plausible single open request, still unexplained why it didn't match: ${buckets.plausibleButUnexplained}`);
console.log(`  (the real bug candidates — worth a closer manual look)`);

if (latenciesMs.length) {
  latenciesMs.sort((a, b) => a - b);
  const median = latenciesMs[Math.floor(latenciesMs.length / 2)];
  const p90 = latenciesMs[Math.floor(latenciesMs.length * 0.9)];
  console.log(`\nDispatch-to-reply latency — median: ${Math.round(median / 60000)} min, p90: ${Math.round(p90 / 60000)} min`);
}

for (const [bucket, rows] of Object.entries(examples)) {
  if (!rows.length) continue;
  console.log(`\n--- ${bucket} examples ---`);
  for (const row of rows) {
    console.log(`  ${row.received_at} [${row.gateway_id}] ${JSON.stringify({
      requestStatus: row.requestStatus, openCount: row.openCount, latencyMin: row.latencyMin
    })}`);
    console.log(`    ${(row.message_body || '').slice(0, 90).replace(/\n/g, ' \\n ')}`);
  }
}
