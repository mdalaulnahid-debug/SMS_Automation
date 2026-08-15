#!/usr/bin/env node
'use strict';

// Read-only. Audits every correction applied by apply-historical-
// corrections.js using the signal that actually matters for HISTORICAL
// backlog correction: does the request's specific payload (the exact
// phone number / IMEI / NID) appear in the reply text?
//
// This is a deliberately different question from "was this within the
// live 15-minute reply window" (see verify-applied-corrections.js). For
// live, real-time matching, the window is the right gate -- you can't
// wait around forever. For correcting historical records after the fact,
// a reply that arrived late but unambiguously contains the request's own
// identifier is still almost certainly the right match; the window was
// never evidence about correctness, only about how long the live system
// was willing to wait.
//
// Splits results into:
//   STRONG  (payload/identifier match)      -- very likely correct regardless of timing
//   WEAK    (type-pattern match only, no identifier confirmation) -- worth a manual look
//   NONE    (analysis can't even reproduce a type match anymore)  -- worth a manual look
//
// Run on the server:
//   node scripts/audit-applied-corrections-by-payload.js

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { analyzeOperatorReply } = require('../src/replyAnalyzer');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');

const appliedLogs = db.prepare(`
  SELECT id, request_id, details, timestamp
  FROM audit_logs
  WHERE action = 'BACKLOG_MATCH_CORRECTED'
  ORDER BY timestamp
`).all();

console.log(`Auditing ${appliedLogs.length} applied backlog corrections by payload/identifier match...\n`);

let strong = 0;
let weak = 0;
let none = 0;
const weakExamples = [];
const noneExamples = [];

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

  const inbox = db.prepare('SELECT message_body FROM sms_inbox WHERE id = ?').get(inboxId);
  const request = db.prepare('SELECT request_id, request_type, payload, operator, status, created_at FROM requests WHERE request_id = ?').get(requestId);
  if (!inbox || !request) {
    none++;
    noneExamples.push({ inboxId, requestId, reason: 'inbox or request row no longer exists' });
    continue;
  }

  const analysis = analyzeOperatorReply({
    request: { requestType: request.request_type, payload: request.payload, operator: request.operator },
    messageBody: inbox.message_body
  });

  if (analysis.payloadMatched) {
    strong++;
  } else if (analysis.patternMatched) {
    weak++;
    if (weakExamples.length < 15) {
      weakExamples.push({ inboxId, requestId, requestType: request.request_type, payload: request.payload, body: inbox.message_body });
    }
  } else {
    none++;
    if (noneExamples.length < 15) {
      noneExamples.push({ inboxId, requestId, requestType: request.request_type, payload: request.payload, body: inbox.message_body });
    }
  }

  if ((i + 1) % 500 === 0 || i === appliedLogs.length - 1) {
    console.log(`  ...audited ${i + 1}/${appliedLogs.length}`);
  }
}

console.log(`\nSTRONG (payload/identifier actually appears in the reply -- correct with high confidence): ${strong}`);
console.log(`WEAK (only a type-pattern match, no identifier confirmation -- worth a look): ${weak}`);
console.log(`NONE (can't even reproduce a type match -- worth a look): ${none}\n`);

if (weakExamples.length) {
  console.log('--- WEAK examples ---');
  for (const e of weakExamples) {
    console.log(`  inbox ${e.inboxId} -> ${e.requestId} (${e.requestType} ${e.payload})`);
    console.log(`    reply: ${(e.body || '').replace(/\n/g, ' \\n ').slice(0, 140)}`);
  }
}

if (noneExamples.length) {
  console.log('\n--- NONE examples ---');
  for (const e of noneExamples) {
    console.log(`  inbox ${e.inboxId} -> ${e.requestId}${e.requestType ? ` (${e.requestType} ${e.payload})` : ''}`);
    if (e.body) console.log(`    reply: ${(e.body || '').replace(/\n/g, ' \\n ').slice(0, 140)}`);
    if (e.reason) console.log(`    ${e.reason}`);
  }
}
