#!/usr/bin/env node
'use strict';

// Read-only. Buckets every unmatched sms_inbox row using the SAME
// pattern-matching the real reply-matching engine uses (replyAnalyzer's
// inferReplyFamilies), so "does this look like a genuine reply" isn't a
// guess — it's the actual classifier. Splits into:
//   A) looks like a real reply (a request family was inferred) but still
//      never matched a request — these are the real bug candidates
//   B) recognizable junk (WhatsApp/OTP-style codes, obviously unrelated)
//   C) unrecognized format — no strong pattern, not obviously junk either
//
// Run on the server:
//   node scripts/classify-unmatched.js

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { inferReplyFamilies } = require('../src/replyAnalyzer');

const dbPath = process.env.SMS_DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;'); // wait briefly instead of erroring if the live server holds the lock

// Excludes rows the system itself already flagged as ignored -- an
// inbound SMS from a sender not in that gateway's trustedSenders list
// (config/gateways.json) is stored with analysis.ignored=true and never
// was a real operator reply to begin with (see service.js's
// receiveSmsWebhook / SMS_IGNORED_UNTRUSTED_SENDER). The real admin
// console's Unmatched SMS view already excludes these
// (buildAdminData's `!row.analysis?.ignored` filter in src/app.js); this
// script now matches that.
const rows = db.prepare(`
  SELECT id, gateway_id, sender_number, message_body, received_at
  FROM sms_inbox
  WHERE matched_request_id IS NULL
    AND (analysis IS NULL OR analysis NOT LIKE '%"ignored":true%')
`).all();

const JUNK_MARKERS = [/whatsapp/i, /verification code/i, /otp\b/i, /one-time password/i, /don't share this code/i];

const buckets = { genuineLookingButUnmatched: [], junk: [], unrecognized: [] };

for (const row of rows) {
  const body = row.message_body || '';
  if (JUNK_MARKERS.some((re) => re.test(body))) {
    buckets.junk.push(row);
    continue;
  }
  const { strongTypes } = inferReplyFamilies(body, '');
  if (strongTypes.length > 0) {
    buckets.genuineLookingButUnmatched.push({ ...row, inferredTypes: strongTypes });
  } else {
    buckets.unrecognized.push(row);
  }
}

const total = rows.length;
function pct(n) {
  return total ? ((n / total) * 100).toFixed(1) : '0.0';
}

console.log(`Total unmatched: ${total}\n`);
console.log(`A) Looks like a genuine reply, still unmatched: ${buckets.genuineLookingButUnmatched.length} (${pct(buckets.genuineLookingButUnmatched.length)}%)  <- the real bug candidates`);
console.log(`B) Recognizable junk (WhatsApp/OTP-style, unrelated to the system): ${buckets.junk.length} (${pct(buckets.junk.length)}%)`);
console.log(`C) Unrecognized format (neither a known reply pattern nor obvious junk): ${buckets.unrecognized.length} (${pct(buckets.unrecognized.length)}%)`);

console.log('\n--- Bucket A: inferred request type breakdown ---');
const byType = {};
for (const row of buckets.genuineLookingButUnmatched) {
  for (const t of row.inferredTypes) byType[t] = (byType[t] || 0) + 1;
}
for (const [type, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type}: ${n}`);
}

console.log('\n--- Bucket A: 8 samples (the ones worth investigating) ---');
for (const row of buckets.genuineLookingButUnmatched.slice(-8)) {
  console.log(`  ${row.received_at} [${row.gateway_id}] types=${row.inferredTypes.join(',')}`);
  console.log(`    ${(row.message_body || '').slice(0, 100).replace(/\n/g, ' \\n ')}`);
}

console.log('\n--- Bucket C: 5 samples (unrecognized format) ---');
for (const row of buckets.unrecognized.slice(-5)) {
  console.log(`  ${row.received_at} [${row.gateway_id}]`);
  console.log(`    ${(row.message_body || '').slice(0, 100).replace(/\n/g, ' \\n ')}`);
}
