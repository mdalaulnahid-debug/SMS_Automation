#!/usr/bin/env node
'use strict';

// Database-only correction for the specific backlog left by the multi-identifier
// premature-completion bug (fixed 2026-08-17): a dispatch carrying several
// identifiers used to finalize (and often auto-post) after just the FIRST reply,
// leaving every reply for the OTHER identifiers in that same payload permanently
// unmatched even though they genuinely belong to that request.
//
// Scope is deliberately narrow and precise -- NOT the general ambiguous-backlog
// problem (already handled separately): only requests whose payload has MORE
// THAN ONE identifier are considered, since single-identifier requests were never
// affected by this bug.
//
// For each genuine unmatched SMS, finds candidate dispatches on the SAME gateway
// sent before it (within a generous late window, since these can be duplicate/
// late operator resends), scores them with the exact same analyzeOperatorReply()
// used everywhere else this session, and only applies a match when the reply's
// own identifier is STRONG-confirmed (payloadMatched) against EXACTLY ONE
// candidate -- skips anything ambiguous rather than guessing.
//
// Same philosophy as apply-historical-corrections.js: sets sms_inbox.matched_
// request_id directly. NO reply draft, NO Telegram post, NO status change --
// these requests already finalized and posted long ago; this only makes the
// historical record accurate.
//
// Usage:
//   node scripts/correct-multi-id-orphaned-replies.js            # dry run
//   node scripts/correct-multi-id-orphaned-replies.js --apply    # actually writes

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { AutomationStore } = require('../src/store');
const { analyzeOperatorReply } = require('../src/replyAnalyzer');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const apply = process.argv.includes('--apply');
const LATE_WINDOW_MS = 24 * 60 * 60 * 1000; // generous -- historical correction, not live matching

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');

const unmatched = db.prepare(`
  SELECT id, gateway_id, message_body, received_at
  FROM sms_inbox
  WHERE matched_request_id IS NULL
    AND (analysis IS NULL OR analysis NOT LIKE '%"ignored":true%')
`).all();

console.log(`Scanning ${unmatched.length} genuine unmatched rows for multi-identifier orphaned replies...`);

const dispatchesByGateway = new Map();
function multiIdDispatchesFor(gatewayId) {
  if (!dispatchesByGateway.has(gatewayId)) {
    const rows = db.prepare(`
      SELECT rd.request_id, rd.sent_at,
             r.request_type, r.payload, r.operator, r.status, r.created_at
      FROM request_dispatches rd
      JOIN requests r ON r.request_id = rd.request_id
      WHERE rd.gateway_id = ? AND rd.sent_at IS NOT NULL
      ORDER BY rd.sent_at
    `).all(gatewayId);
    dispatchesByGateway.set(gatewayId, rows.filter((d) => {
      return String(d.payload || '').trim().split(/\s+/).filter(Boolean).length > 1;
    }));
  }
  return dispatchesByGateway.get(gatewayId);
}

const toApply = [];
let noCandidate = 0;
let ambiguous = 0;
let startedAt = Date.now();

for (let i = 0; i < unmatched.length; i++) {
  const row = unmatched[i];
  const replyTime = new Date(row.received_at).getTime();
  const candidates = multiIdDispatchesFor(row.gateway_id).filter((d) => {
    const sentAt = new Date(d.sent_at).getTime();
    return sentAt <= replyTime && replyTime - sentAt <= LATE_WINDOW_MS;
  });

  if (!candidates.length) {
    noCandidate++;
  } else {
    const strong = candidates.filter((d) => {
      const analysis = analyzeOperatorReply({
        request: { requestType: d.request_type, payload: d.payload, operator: d.operator },
        messageBody: row.message_body
      });
      return analysis.payloadMatched;
    });
    if (strong.length === 1) {
      toApply.push({ inboxId: row.id, requestId: strong[0].request_id });
    } else if (strong.length > 1) {
      ambiguous++;
    } else {
      noCandidate++;
    }
  }

  if ((i + 1) % 500 === 0 || i === unmatched.length - 1) {
    console.log(`  ...scanned ${i + 1}/${unmatched.length} (${((Date.now() - startedAt) / 1000).toFixed(1)}s elapsed)`);
  }
}

console.log(`\nGenuine unmatched rows scanned: ${unmatched.length}`);
console.log(`Corrections to apply (unambiguous payload match to a multi-identifier request): ${toApply.length}`);
console.log(`Ambiguous (payload matched more than one candidate -- skipped): ${ambiguous}`);
console.log(`No confident candidate: ${noCandidate}\n`);

if (!apply) {
  console.log('Dry run only -- nothing written. Re-run with --apply to write these corrections.');
  process.exit(0);
}

console.log('--apply passed -- writing database-only corrections (no reply drafts, nothing posted anywhere)...');
const store = new AutomationStore({}, { dbPath });
const inboxById = new Map(store.smsInbox.map((r) => [r.id, r]));
let applied = 0;
let alreadyMatched = 0;
const applyStartedAt = Date.now();
for (let i = 0; i < toApply.length; i++) {
  const { inboxId, requestId } = toApply[i];
  const inbox = inboxById.get(inboxId);
  if (!inbox || inbox.matchedRequestId) {
    alreadyMatched++;
  } else {
    inbox.matchedRequestId = requestId;
    if (store.persistence) store.persistence.insertInbox(inbox);
    store.audit('system', 'BACKLOG_MULTI_ID_REPLY_ATTACHED', requestId, {
      inboxId,
      note: 'Database-only correction via scripts/correct-multi-id-orphaned-replies.js -- orphaned by the multi-identifier premature-completion bug, no reply draft created, nothing posted to Telegram.'
    });
    applied++;
  }
  if ((i + 1) % 500 === 0 || i === toApply.length - 1) {
    console.log(`  ...applied ${i + 1}/${toApply.length} (${((Date.now() - applyStartedAt) / 1000).toFixed(1)}s elapsed)`);
  }
}
console.log(`\nApplied ${applied} corrections. (${alreadyMatched} were already matched by the time this ran, skipped.)`);
