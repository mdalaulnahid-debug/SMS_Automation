#!/usr/bin/env node
'use strict';

// Read-only. Analyzes EVERY genuine unmatched SMS received within the last
// N hours (default 48) -- not just the most recent handful like
// explain-recent-unmatched.js -- and buckets each by why it's unmatched,
// using the same reasoning: ambiguous (multiple requests open on the
// gateway at once), late (the one open request had already resolved by
// the time the reply arrived), no dispatch (not from any request this
// system sent), or unexplained (worth a close look -- a single open
// candidate that still didn't match, which is the shape a real bug would
// take).
//
// Prints full detail for every "unexplained" row (the bucket most likely
// to indicate an actual bug) and a one-line summary for the rest.
//
// Run on the server:
//   node scripts/analyze-unmatched-window.js         # last 48h
//   node scripts/analyze-unmatched-window.js 24       # last 24h

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { DEFAULT_REPLY_WINDOW_MS } = require('../src/service');

const dbPath = process.env.SMS_DB_PATH || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');

const hours = Number(process.argv[2]) || 48;
const sinceIso = new Date(Date.now() - hours * 3600_000).toISOString();

const totalInWindow = db.prepare(`
  SELECT COUNT(*) as n FROM sms_inbox
  WHERE received_at >= ?
    AND (analysis IS NULL OR analysis NOT LIKE '%"ignored":true%')
`).get(sinceIso);

const rows = db.prepare(`
  SELECT id, gateway_id, sender_number, message_body, received_at
  FROM sms_inbox
  WHERE matched_request_id IS NULL
    AND received_at >= ?
    AND (analysis IS NULL OR analysis NOT LIKE '%"ignored":true%')
  ORDER BY received_at ASC
`).all(sinceIso);

console.log(`Window: last ${hours}h (since ${sinceIso})`);
console.log(`Genuine SMS received in window: ${totalInWindow.n}`);
console.log(`Of those, currently unmatched: ${rows.length}\n`);

const dispatchesByGateway = new Map();
function dispatchesFor(gatewayId) {
  if (!dispatchesByGateway.has(gatewayId)) {
    dispatchesByGateway.set(gatewayId, db.prepare(`
      SELECT rd.request_id, rd.sent_at, rd.replied_at,
             r.status, r.request_type, r.payload, r.operator, r.requester_name
      FROM request_dispatches rd
      JOIN requests r ON r.request_id = rd.request_id
      WHERE rd.gateway_id = ? AND rd.sent_at IS NOT NULL
      ORDER BY rd.sent_at
    `).all(gatewayId));
  }
  return dispatchesByGateway.get(gatewayId);
}

let ambiguous = 0;
let late = 0;
let noDispatch = 0;
const unexplained = [];

for (const row of rows) {
  const replyTime = new Date(row.received_at).getTime();
  const candidates = dispatchesFor(row.gateway_id).filter((d) => new Date(d.sent_at).getTime() <= replyTime);

  if (!candidates.length) {
    noDispatch++;
    continue;
  }

  const openAtReplyTime = candidates.filter((d) => {
    const sentAt = new Date(d.sent_at).getTime();
    if (sentAt + DEFAULT_REPLY_WINDOW_MS < replyTime) return false;
    if (!d.replied_at) return true;
    return new Date(d.replied_at).getTime() > replyTime;
  });

  if (openAtReplyTime.length > 1) {
    ambiguous++;
    continue;
  }

  if (openAtReplyTime.length === 1) {
    const nearest = openAtReplyTime[0];
    const latencyMin = Math.round((replyTime - new Date(nearest.sent_at).getTime()) / 60000);
    unexplained.push({ row, nearest, latencyMin, reason: 'single open candidate, still no match' });
    continue;
  }

  const nearest = candidates[candidates.length - 1];
  const latencyMin = Math.round((replyTime - new Date(nearest.sent_at).getTime()) / 60000);
  if (latencyMin > DEFAULT_REPLY_WINDOW_MS / 60000) {
    late++;
  } else {
    unexplained.push({ row, nearest, latencyMin, reason: 'closest dispatch not technically "open" but recent -- worth a look' });
  }
}

console.log(`Ambiguous (multiple requests open at once): ${ambiguous}`);
console.log(`Late (nearest dispatch already resolved before reply arrived): ${late}`);
console.log(`No dispatch at all on that gateway: ${noDispatch}`);
console.log(`Unexplained (worth manual review): ${unexplained.length}\n`);

if (unexplained.length) {
  console.log('--- Unexplained rows (full detail) ---');
  for (const { row, nearest, latencyMin, reason } of unexplained) {
    console.log(`\n━━━ inbox ${row.id} [${row.gateway_id}] ${row.sender_number} @ ${row.received_at} ━━━`);
    console.log(`  ${(row.message_body || '').replace(/\n/g, ' \\n ')}`);
    console.log(`  REASON: ${reason}`);
    console.log(`  Nearest dispatch: ${nearest.request_id} (${nearest.request_type} ${nearest.payload}, ${nearest.status}, requester ${nearest.requester_name}), sent ${nearest.sent_at}, ${latencyMin} min before this reply${nearest.replied_at ? `, already replied_at=${nearest.replied_at}` : ''}`);
  }
}
