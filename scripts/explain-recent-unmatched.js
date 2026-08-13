#!/usr/bin/env node
'use strict';

// Read-only. Takes the N most recent genuine unmatched SMS (untrusted-
// sender noise already excluded, same filter as the other diagnostic
// scripts) and explains EXACTLY why each one didn't match a request --
// not aggregate bucket counts, but a per-row cause, including the actual
// competing candidate requests when the reason is ambiguity. Answers two
// concrete questions: (1) is this backlog historical or still growing
// from current, valid operator replies, and (2) for each recent one,
// precisely what happened.
//
// Run on the server:
//   node scripts/explain-recent-unmatched.js          # last 20
//   node scripts/explain-recent-unmatched.js 50        # last 50

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { DEFAULT_REPLY_WINDOW_MS } = require('../src/service');

const dbPath = process.env.SMS_DB_PATH || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');

const limit = Number(process.argv[2]) || 20;

const rows = db.prepare(`
  SELECT id, gateway_id, sender_number, message_body, received_at
  FROM sms_inbox
  WHERE matched_request_id IS NULL
    AND (analysis IS NULL OR analysis NOT LIKE '%"ignored":true%')
  ORDER BY received_at DESC
  LIMIT ?
`).all(limit);

console.log(`Most recent ${rows.length} genuine unmatched SMS (untrusted-sender noise excluded):\n`);

const dispatchesByGateway = new Map();
function dispatchesFor(gatewayId) {
  if (!dispatchesByGateway.has(gatewayId)) {
    dispatchesByGateway.set(gatewayId, db.prepare(`
      SELECT rd.request_id, rd.sent_at, rd.replied_at,
             r.status, r.request_type, r.payload, r.operator, r.requester_name, r.channel
      FROM request_dispatches rd
      JOIN requests r ON r.request_id = rd.request_id
      WHERE rd.gateway_id = ? AND rd.sent_at IS NOT NULL
      ORDER BY rd.sent_at
    `).all(gatewayId));
  }
  return dispatchesByGateway.get(gatewayId);
}

const now = Date.now();
let ambiguousCount = 0;
let lateCount = 0;
let noDispatchCount = 0;

for (const row of rows) {
  const replyTime = new Date(row.received_at).getTime();
  const ageMin = Math.round((now - replyTime) / 60000);
  const ageStr = ageMin < 60 ? `${ageMin}m ago` : ageMin < 1440 ? `${Math.round(ageMin / 60)}h ago` : `${Math.round(ageMin / 1440)}d ago`;

  console.log(`━━━ inbox ${row.id} [${row.gateway_id}] ${row.sender_number} @ ${row.received_at} (${ageStr}) ━━━`);
  console.log(`  ${(row.message_body || '').replace(/\n/g, ' \\n ')}`);

  const candidates = dispatchesFor(row.gateway_id).filter((d) => new Date(d.sent_at).getTime() <= replyTime);

  if (!candidates.length) {
    noDispatchCount++;
    console.log('  WHY UNMATCHED: no dispatch at all was ever sent to this gateway before this reply arrived.');
    console.log('  -> Not from any request this system sent. Likely a service notice, wrong number, or unrelated text to the SIM.\n');
    continue;
  }

  const nearest = candidates[candidates.length - 1];
  // "Open" bounded by the real reply window (DEFAULT_REPLY_WINDOW_MS) --
  // a dispatch that already timed out is not a real candidate just
  // because nothing ever set replied_at on it.
  const openAtReplyTime = candidates.filter((d) => {
    const sentAt = new Date(d.sent_at).getTime();
    if (sentAt + DEFAULT_REPLY_WINDOW_MS < replyTime) return false;
    if (!d.replied_at) return true;
    return new Date(d.replied_at).getTime() > replyTime;
  });

  if (openAtReplyTime.length > 1) {
    ambiguousCount++;
    console.log(`  WHY UNMATCHED: ${openAtReplyTime.length} requests were open on this gateway at the same moment -- genuinely ambiguous, no safe auto-match.`);
    console.log('  Competing candidates:');
    for (const c of openAtReplyTime) {
      console.log(`    - ${c.request_id} (${c.request_type} ${c.payload}, ${c.status}, requested by ${c.requester_name}, sent ${c.sent_at})`);
    }
    console.log('');
    continue;
  }

  const latencyMin = Math.round((replyTime - new Date(nearest.sent_at).getTime()) / 60000);
  const terminalStatuses = ['REPLY_POSTED', 'FAILED', 'QUEUED'];
  if (terminalStatuses.includes(nearest.status)) {
    lateCount++;
    console.log(`  WHY UNMATCHED: the one open request (${nearest.request_id}, ${nearest.request_type} ${nearest.payload}) had already moved to ${nearest.status} by the time this reply arrived (${latencyMin} min after it was sent).`);
    console.log('  -> Operator reply came in too late; the request had already resolved another way.\n');
    continue;
  }

  console.log(`  WHY UNMATCHED: unclear -- single open candidate ${nearest.request_id} (${nearest.request_type} ${nearest.payload}, ${nearest.status}), ${latencyMin} min after dispatch. Worth a manual look.\n`);
}

console.log('--- Summary ---');
console.log(`Ambiguous (multiple open requests at once): ${ambiguousCount}`);
console.log(`Late (request already resolved before reply arrived): ${lateCount}`);
console.log(`No dispatch at all (not from any request this system sent): ${noDispatchCount}`);
console.log(`Unexplained (worth manual review): ${rows.length - ambiguousCount - lateCount - noDispatchCount}`);
