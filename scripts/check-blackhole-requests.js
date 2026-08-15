#!/usr/bin/env node
'use strict';

// Read-only. Groups every applied BACKLOG_MATCH_CORRECTED entry by target
// request and shows which requests absorbed an unusually large number of
// distinct inbox rows -- the signature of the old unbounded-open-window
// bug: a request whose own dispatch never got replied_at set could look
// "open forever" and become a fallback candidate for every subsequent
// unrelated reply on that gateway, for as long as it stayed the only
// thing technically "unreplied."
//
// Run on the server:
//   node scripts/check-blackhole-requests.js

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');

const rows = db.prepare(`
  SELECT request_id, details, timestamp
  FROM audit_logs
  WHERE action = 'BACKLOG_MATCH_CORRECTED'
`).all();

const byRequest = new Map();
for (const row of rows) {
  let details;
  try {
    details = JSON.parse(row.details || '{}');
  } catch {
    details = {};
  }
  if (!row.request_id || !details.inboxId) continue;
  if (!byRequest.has(row.request_id)) byRequest.set(row.request_id, []);
  byRequest.get(row.request_id).push({ inboxId: details.inboxId, timestamp: row.timestamp });
}

const sorted = [...byRequest.entries()].sort((a, b) => b[1].length - a[1].length);

console.log(`${byRequest.size} distinct requests received at least one correction (out of ${rows.length} total corrections).\n`);
console.log('Top 20 by number of inbox rows attached:');
for (const [requestId, entries] of sorted.slice(0, 20)) {
  const req = db.prepare('SELECT request_type, payload, status FROM requests WHERE request_id = ?').get(requestId);
  console.log(`  ${requestId} (${req?.request_type} ${req?.payload}, ${req?.status}): ${entries.length} inbox rows attached`);
}

const singleAttach = sorted.filter(([, entries]) => entries.length === 1).length;
console.log(`\nRequests with exactly 1 inbox row attached (normal): ${singleAttach}`);
console.log(`Requests with more than 1 (worth checking for black-hole behavior): ${sorted.length - singleAttach}`);

// For the top black-hole candidate, show the actual distinct message bodies
// it absorbed, to see if they're genuinely different content (real bug
// signature) or just duplicate/near-duplicate copies of the same message.
if (sorted.length && sorted[0][1].length > 1) {
  const [topRequestId, topEntries] = sorted[0];
  console.log(`\n--- Distinct message bodies attached to ${topRequestId} (top black-hole candidate) ---`);
  const seen = new Set();
  for (const { inboxId } of topEntries) {
    const inbox = db.prepare('SELECT message_body, received_at FROM sms_inbox WHERE id = ?').get(inboxId);
    if (!inbox) continue;
    const key = inbox.message_body;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  [${inbox.received_at}] ${(inbox.message_body || '').replace(/\n/g, ' \\n ').slice(0, 140)}`);
  }
  console.log(`  (${seen.size} distinct message bodies out of ${topEntries.length} inbox rows attached)`);
}
