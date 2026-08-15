#!/usr/bin/env node
'use strict';

// Read-only. Checks CURRENT sms_inbox.matched_request_id state (not the
// raw audit history, which check-blackhole-requests.js reads and doesn't
// know about later reversals) to confirm reverse-weak-corrections.js
// actually took effect.

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');

const topOffenders = ['REQ-20260617-0039-H71I', 'REQ-20260613-0004-TP9A', 'REQ-20260614-0012-H5A4'];

console.log('Current sms_inbox.matched_request_id counts for the top black-hole requests:');
for (const reqId of topOffenders) {
  const row = db.prepare('SELECT COUNT(*) as n FROM sms_inbox WHERE matched_request_id = ?').get(reqId);
  console.log(`  ${reqId}: ${row.n} currently matched`);
}

const reversedCount = db.prepare(`SELECT COUNT(*) as n FROM audit_logs WHERE action = 'BACKLOG_MATCH_REVERSED'`).get();
console.log(`\nBACKLOG_MATCH_REVERSED audit entries: ${reversedCount.n}`);

const currentlyUnmatched = db.prepare(`
  SELECT COUNT(*) as n FROM sms_inbox
  WHERE matched_request_id IS NULL
    AND (analysis IS NULL OR analysis NOT LIKE '%"ignored":true%')
`).get();
console.log(`Currently unmatched (genuine, noise excluded): ${currentlyUnmatched.n}`);
