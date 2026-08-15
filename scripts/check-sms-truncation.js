#!/usr/bin/env node
'use strict';

// Read-only. Investigates a suspected SMS-truncation bug: some LCL-reply
// messages (MOC/MTC/SMSMT format) arrive with the header intact (phone
// numbers, call type, timestamp) but cut off mid-way through the trailing
// cell-tower-ID bracket / address -- e.g. "...13/08/2026 15:20:11\n[22048 3"
// instead of the expected "...[22048 30552] VILLAGE NAME, ...".
//
// android-gateway's SmsReceiver.kt DOES correctly reassemble a true
// concatenated SMS (Telephony.Sms.Intents.getMessagesFromIntent() + joins
// every part's body) -- so this isn't a "only read part 1 of the PDU"
// bug. The more likely explanation: the operator is sending the reply as
// TWO INDEPENDENT SMS (no shared concatenation reference), and each one
// triggers its own separate broadcast that gets forwarded immediately as
// a "complete" message with no buffering/merge logic at all.
//
// This script tests that hypothesis directly: for every row that LOOKS
// truncated (an LCL-style header with an unclosed trailing "[NNNNN N"
// bracket), does a same-gateway, same-sender row arrive within the next
// few seconds whose body would plausibly complete it? If yes for most
// rows, the fix is a sender+time-window merge (either in the Android app
// before forwarding, or in the backend's ingestion path). If no, the
// second fragment is being lost somewhere else entirely (dropped SMS,
// dropped broadcast, etc.) and the fix is different.
//
// Run on the server:
//   node scripts/check-sms-truncation.js

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = process.env.SMS_DB_PATH || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');

// Looks like an LCL header (phone numbers + MOC/MTC/SMSMO/SMSMT + a date)
// but ends with an opening "[" and some digits, never closed with "]".
const TRUNCATED_TAIL = /\[\d+[\s\d]*$/;
const LCL_HEADER = /\b(?:MOC|MTC|SMSMO|SMSMT)\b/i;

const all = db.prepare(`
  SELECT id, gateway_id, sender_number, message_body, received_at
  FROM sms_inbox
  ORDER BY gateway_id, sender_number, received_at
`).all();

const candidates = all.filter((row) => {
  const body = row.message_body || '';
  return LCL_HEADER.test(body) && TRUNCATED_TAIL.test(body);
});

console.log(`Total inbox rows: ${all.length}`);
console.log(`Rows that look like a truncated LCL reply (header intact, bracket cut off): ${candidates.length}\n`);

if (!candidates.length) {
  console.log('No candidates found -- nothing to check.');
  process.exit(0);
}

// Index all rows by (gateway, sender) so we can look for a nearby follow-up.
const bySenderGateway = new Map();
for (const row of all) {
  const key = `${row.gateway_id}::${row.sender_number}`;
  if (!bySenderGateway.has(key)) bySenderGateway.set(key, []);
  bySenderGateway.get(key).push(row);
}

const FOLLOWUP_WINDOW_MS = 30_000; // generous -- two independent SMS from the same shortcode should land within seconds of each other

let hasFollowup = 0;
let noFollowup = 0;
const followupExamples = [];
const noFollowupExamples = [];

for (const row of candidates) {
  const key = `${row.gateway_id}::${row.sender_number}`;
  const siblings = bySenderGateway.get(key) || [];
  const t = new Date(row.received_at).getTime();

  const followup = siblings.find((other) => {
    if (other.id === row.id) return false;
    const dt = new Date(other.received_at).getTime() - t;
    return dt > 0 && dt <= FOLLOWUP_WINDOW_MS;
  });

  if (followup) {
    hasFollowup++;
    if (followupExamples.length < 5) {
      followupExamples.push({ truncated: row, followup });
    }
  } else {
    noFollowup++;
    if (noFollowupExamples.length < 5) {
      noFollowupExamples.push(row);
    }
  }
}

console.log(`Has a same-sender/gateway follow-up SMS within ${FOLLOWUP_WINDOW_MS / 1000}s: ${hasFollowup}`);
console.log(`No follow-up found within that window: ${noFollowup}\n`);

console.log('--- Examples WITH a follow-up (supports the "two independent SMS" theory) ---');
for (const { truncated, followup } of followupExamples) {
  const gapMs = new Date(followup.received_at).getTime() - new Date(truncated.received_at).getTime();
  console.log(`  [${truncated.gateway_id}] ${truncated.sender_number} @ ${truncated.received_at} (+${(gapMs / 1000).toFixed(1)}s later)`);
  console.log(`    truncated: ${(truncated.message_body || '').replace(/\n/g, ' \\n ')}`);
  console.log(`    follow-up: ${(followup.message_body || '').slice(0, 120).replace(/\n/g, ' \\n ')}`);
}

console.log('\n--- Examples with NO follow-up found (second fragment may be lost entirely) ---');
for (const row of noFollowupExamples) {
  console.log(`  [${row.gateway_id}] ${row.sender_number} @ ${row.received_at}`);
  console.log(`    ${(row.message_body || '').replace(/\n/g, ' \\n ')}`);
}
