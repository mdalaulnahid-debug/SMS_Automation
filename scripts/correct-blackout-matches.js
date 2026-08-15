'use strict';

// Supervised correction tool for the 2026-07-05 blackout cross-matching incident.
// A reply was attached to the wrong request because the old matcher was content-blind
// (fixed in commit b0412fc: replyContradictsPayload gate). This tool helps re-attach
// the CORRECT operator reply to each affected request via the audited correctMatch API.
//
// SAFETY: dry-run by default. It NEVER writes on its own. --apply only acts on the
// exact request=inbox pairs you pass, and each correction issues a "⚠️ Correction"
// reply draft (which auto-posts to the officer on auto-approve channels).
//
// Usage (run on the VPS, where the DB + backend live):
//   node --experimental-sqlite scripts/correct-blackout-matches.js
//       → dry-run report: for each affected request+operator, list the currently
//         attached (wrong) reply and the candidate CORRECT inbox rows to pick from.
//   node --experimental-sqlite scripts/correct-blackout-matches.js \
//       --apply --key <ADMIN_API_KEY> --pairs "REQ-...=inbox_xxx;REQ-...=inbox_yyy"
//       → for each approved pair, POST /api/admin/correct-match (audited).
//
// Env overrides: GRAPHIFY? no. DB_PATH (default /opt/sms-backend/data/automation.db),
//                API_BASE (default http://localhost:3000).

const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || '/opt/sms-backend/data/automation.db';
const API_BASE = process.env.API_BASE || 'http://localhost:3000';

// The 8 requests found cross-matched, with their wrong operator(s).
const AFFECTED = [
  ['REQ-20260621-0159-RQNE', ['BANGLALINK']],
  ['REQ-20260621-0186-UQR7', ['ROBI']],
  ['REQ-20260623-0345-SM4E', ['GP']],
  ['REQ-20260628-0645-I1Z6', ['BANGLALINK', 'GP']],
  ['REQ-20260704-1045-E49U', ['GP']],
  ['REQ-20260704-1064-SXBT', ['GP']],
  ['REQ-20260705-1249-3IIZ', ['GP']],
  ['REQ-20260705-1276-07SE', ['BANGLALINK', 'GP']]
];
const OP_GW = { GP: 'GP_PHONE_01', ROBI: 'ROBI_PHONE_01', BANGLALINK: 'BANGLALINK_PHONE_01' };

const imeis = (s) => String(s).match(/\b\d{14,15}\b/g) || [];
const snip = (s, n = 90) => String(s || '').replace(/\s+/g, ' ').slice(0, n);

function parseArgs(argv) {
  const args = { apply: false, key: '', pairs: '' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--key') args.key = argv[++i];
    else if (argv[i] === '--pairs') args.pairs = argv[++i];
  }
  return args;
}

function dryRun() {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const body = (id) => (db.prepare('SELECT message_body m FROM sms_inbox WHERE id=?').get(id) || {}).m || '';
  console.log('DRY RUN — proposed corrections (no writes). Review, then re-run with --apply.\n');
  for (const [rid, ops] of AFFECTED) {
    const r = db.prepare('SELECT payload,status FROM requests WHERE request_id=?').get(rid);
    if (!r) { console.log(`${rid}: NOT FOUND`); continue; }
    const want = imeis(r.payload);
    console.log(`${rid} [${r.status}] payload IMEIs: ${want.join(', ')}`);
    for (const op of ops) {
      const gw = OP_GW[op];
      const d = db.prepare('SELECT inbox_id FROM request_dispatches WHERE request_id=? AND operator=?').get(rid, op);
      const wrong = d && d.inbox_id ? body(d.inbox_id) : '';
      console.log(`  ${op} — currently attached (WRONG): ${d && d.inbox_id} | ${snip(wrong)}`);
      const rows = db.prepare('SELECT id,matched_request_id,received_at FROM sms_inbox WHERE gateway_id=?').all(gw);
      const cands = rows.filter((row) => {
        const b = body(row.id);
        return want.some((w) => b.includes(w));
      });
      if (!cands.length) { console.log('    correct-reply candidates: NONE FOUND'); continue; }
      for (const c of cands) {
        console.log(`    candidate ${c.id}  matched=${c.matched_request_id || 'NULL'}  ${c.received_at}\n        ${snip(body(c.id), 120)}`);
      }
    }
    console.log('');
  }
  db.close();
}

async function apply(key, pairsRaw) {
  if (!key) { console.error('ERROR: --apply requires --key <ADMIN_API_KEY>'); process.exit(1); }
  const pairs = pairsRaw.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const [requestId, inboxId] = p.split('=').map((x) => x.trim());
    return { requestId, inboxId };
  });
  if (!pairs.length) { console.error('ERROR: --pairs "REQ=inbox;REQ=inbox" required'); process.exit(1); }
  for (const { requestId, inboxId } of pairs) {
    process.stdout.write(`correct-match ${requestId} <- ${inboxId} ... `);
    try {
      const res = await fetch(`${API_BASE}/api/admin/correct-match`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ inboxId, requestId })
      });
      const text = await res.text();
      console.log(res.ok ? 'OK' : `FAILED ${res.status}: ${text.slice(0, 160)}`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }
}

const args = parseArgs(process.argv);
if (args.apply) apply(args.key, args.pairs);
else dryRun();
