#!/usr/bin/env node
'use strict';

// Reverses a specific, dangerous artifact of the old unbounded-open-window
// bug: a request whose own dispatch never got replied_at set could look
// "open forever" and silently absorb hundreds of UNRELATED replies over
// days/weeks as the only fallback candidate (confirmed live: one request
// absorbed 627 inbox rows spanning 11 days of completely unrelated IMEI/
// MSISDN/NID data). audit-applied-corrections-by-payload.js already
// showed the fix: STRONG matches (the request's own payload/identifier
// actually appears in the reply) are independently verified by content
// and should stay; WEAK matches (type-pattern only, no identifier
// confirmation) have no real evidence behind them and should be reversed
// back to unmatched.
//
// For every BACKLOG_MATCH_CORRECTED entry that re-classifies as WEAK or
// NONE today, this sets sms_inbox.matched_request_id back to NULL --
// restoring it to unmatched, exactly where it was before the earlier
// script's mistake -- and logs a BACKLOG_MATCH_REVERSED audit entry.
// STRONG matches are left completely untouched.
//
// Usage:
//   node scripts/reverse-weak-corrections.js            # dry run, shows what would be reversed
//   node scripts/reverse-weak-corrections.js --apply     # actually writes

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { AutomationStore } = require('../src/store');
const { analyzeOperatorReply } = require('../src/replyAnalyzer');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const apply = process.argv.includes('--apply');

// --- Classification pass (read-only, raw SQL) ---
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');

const appliedLogs = db.prepare(`
  SELECT id, request_id, details, timestamp
  FROM audit_logs
  WHERE action = 'BACKLOG_MATCH_CORRECTED'
  ORDER BY timestamp
`).all();

console.log(`Classifying ${appliedLogs.length} applied backlog corrections...`);

const toReverse = [];
let strong = 0;
let alreadyGone = 0;

for (let i = 0; i < appliedLogs.length; i++) {
  const log = appliedLogs[i];
  let details;
  try {
    details = JSON.parse(log.details || '{}');
  } catch {
    details = {};
  }
  const inboxId = details.inboxId;
  const requestId = log.request_id;
  if (!inboxId || !requestId) continue;

  const inbox = db.prepare('SELECT id, matched_request_id, message_body FROM sms_inbox WHERE id = ?').get(inboxId);
  const request = db.prepare('SELECT request_type, payload, operator FROM requests WHERE request_id = ?').get(requestId);
  if (!inbox || !request) {
    alreadyGone++;
    continue;
  }
  // Only ever touch a row that's still matched to the request we applied --
  // if it's since been changed by something else, leave it alone entirely.
  if (inbox.matched_request_id !== requestId) {
    alreadyGone++;
    continue;
  }

  const analysis = analyzeOperatorReply({
    request: { requestType: request.request_type, payload: request.payload, operator: request.operator },
    messageBody: inbox.message_body
  });

  if (analysis.payloadMatched) {
    strong++;
  } else {
    toReverse.push({ inboxId, requestId });
  }

  if ((i + 1) % 500 === 0 || i === appliedLogs.length - 1) {
    console.log(`  ...classified ${i + 1}/${appliedLogs.length}`);
  }
}

console.log(`\nSTRONG (payload-confirmed, left alone): ${strong}`);
console.log(`To reverse (no identifier confirmation): ${toReverse.length}`);
console.log(`Already changed since being applied (skipped): ${alreadyGone}\n`);

if (!apply) {
  console.log('Dry run only -- nothing written. Re-run with --apply to reverse these.');
  process.exit(0);
}

console.log(`--apply passed -- reversing ${toReverse.length} corrections back to unmatched...`);
const store = new AutomationStore({}, { dbPath });
const inboxById = new Map(store.smsInbox.map((r) => [r.id, r]));
let reversed = 0;
for (let i = 0; i < toReverse.length; i++) {
  const { inboxId, requestId } = toReverse[i];
  const inbox = inboxById.get(inboxId);
  if (!inbox || inbox.matchedRequestId !== requestId) continue; // re-check against live state
  inbox.matchedRequestId = null;
  if (store.persistence) store.persistence.insertInbox(inbox);
  store.audit('system', 'BACKLOG_MATCH_REVERSED', requestId, {
    inboxId,
    note: 'Reversed by scripts/reverse-weak-corrections.js -- no payload/identifier confirmation, likely absorbed by the old unbounded-open-window bug.'
  });
  reversed++;
  if ((i + 1) % 500 === 0 || i === toReverse.length - 1) {
    console.log(`  ...reversed ${i + 1}/${toReverse.length}`);
  }
}
console.log(`\nReversed ${reversed} corrections back to unmatched.`);
