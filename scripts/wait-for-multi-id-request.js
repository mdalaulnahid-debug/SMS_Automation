#!/usr/bin/env node
'use strict';
// Polls for the first multi-identifier request created after a given cutoff whose dispatches
// have all reached a terminal state (REPLY_RECEIVED/TIMEOUT/FAILED) -- i.e. fully resolved --
// then prints full detail proving whether the fix worked (all expected identifiers captured,
// dispatch waited instead of closing on the first reply).
// Usage: node scripts/wait-for-multi-id-request.js <cutoffIso>
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const cutoff = process.argv[2];
if (!cutoff) { console.error('Usage: wait-for-multi-id-request.js <cutoffIso>'); process.exit(2); }

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');

const requests = db.prepare(`
  SELECT request_id, request_type, payload, status, created_at
  FROM requests
  WHERE created_at >= ?
  ORDER BY created_at
`).all(cutoff);

const multi = requests.filter((r) => String(r.payload || '').trim().split(/\s+/).filter(Boolean).length > 1);
const resolved = multi.filter((r) => ['COMPLETED', 'TIMEOUT', 'NEEDS_MANUAL_REVIEW', 'FAILED'].includes(r.status));

if (!resolved.length) {
  console.log(`NOT_YET (checked ${requests.length} requests since cutoff, ${multi.length} multi-identifier, 0 resolved)`);
  process.exit(1);
}

for (const r of resolved) {
  console.log(`\n=== ${r.request_id} (${r.request_type} "${r.payload}") status=${r.status} created=${r.created_at} ===`);
  const expected = String(r.payload).trim().split(/\s+/).filter(Boolean).length;
  console.log(`  expected identifiers: ${expected}`);
  const dispatches = db.prepare('SELECT operator, gateway_id, status, sent_at, replied_at FROM request_dispatches WHERE request_id = ?').all(r.request_id);
  for (const d of dispatches) {
    const matched = db.prepare('SELECT message_body, received_at FROM sms_inbox WHERE matched_request_id = ? AND gateway_id = ? ORDER BY received_at').all(r.request_id, d.gateway_id);
    console.log(`  [${d.operator}] status=${d.status} sent=${d.sent_at} replied=${d.replied_at} matchedCount=${matched.length}/${expected}`);
    matched.forEach((m) => console.log(`      @ ${m.received_at}: ${(m.message_body || '').replace(/\n/g, ' \\n ').slice(0, 100)}`));
  }
}
process.exit(0);
