#!/usr/bin/env node
'use strict';

// Read-only diagnostic for the unmatched-SMS backlog. Run on the server:
//   node scripts/diagnose-unmatched.js
// Reports total count, date range, growth pattern (recent vs historical),
// and a breakdown by gateway/operator so you can see whether this is one
// stuck gateway or spread across all of them.

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = process.env.SMS_DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;'); // wait briefly instead of erroring if the live server holds the lock

const total = db.prepare('SELECT COUNT(*) AS n FROM sms_inbox WHERE matched_request_id IS NULL').get().n;
const totalAll = db.prepare('SELECT COUNT(*) AS n FROM sms_inbox').get().n;

console.log(`Unmatched: ${total} / ${totalAll} total inbox rows (${((total / totalAll) * 100).toFixed(1)}%)`);

const range = db.prepare(`
  SELECT MIN(received_at) AS earliest, MAX(received_at) AS latest
  FROM sms_inbox WHERE matched_request_id IS NULL
`).get();
console.log(`Date range: ${range.earliest} to ${range.latest}`);

console.log('\nBy gateway:');
const byGateway = db.prepare(`
  SELECT gateway_id, COUNT(*) AS n
  FROM sms_inbox WHERE matched_request_id IS NULL
  GROUP BY gateway_id ORDER BY n DESC
`).all();
for (const row of byGateway) console.log(`  ${row.gateway_id}: ${row.n}`);

console.log('\nBy month (received_at):');
const byMonth = db.prepare(`
  SELECT substr(received_at, 1, 7) AS month, COUNT(*) AS n
  FROM sms_inbox WHERE matched_request_id IS NULL
  GROUP BY month ORDER BY month
`).all();
for (const row of byMonth) console.log(`  ${row.month}: ${row.n}`);

const last24h = db.prepare(`
  SELECT COUNT(*) AS n FROM sms_inbox
  WHERE matched_request_id IS NULL AND received_at >= datetime('now', '-1 day')
`).get().n;
const last7d = db.prepare(`
  SELECT COUNT(*) AS n FROM sms_inbox
  WHERE matched_request_id IS NULL AND received_at >= datetime('now', '-7 days')
`).get().n;
console.log(`\nNew unmatched in last 24h: ${last24h}`);
console.log(`New unmatched in last 7 days: ${last7d}`);

console.log('\nSample of 5 most recent unmatched (for a quick look):');
const sample = db.prepare(`
  SELECT id, gateway_id, sender_number, received_at,
         substr(message_body, 1, 60) AS body_preview
  FROM sms_inbox WHERE matched_request_id IS NULL
  ORDER BY received_at DESC LIMIT 5
`).all();
for (const row of sample) {
  console.log(`  ${row.received_at} [${row.gateway_id}] ${row.sender_number}: ${row.body_preview}`);
}
