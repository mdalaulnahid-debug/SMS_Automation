#!/usr/bin/env node
'use strict';
// Ad-hoc read-only inspection: dumps every sms_inbox row for a gateway within a time range.
// Usage: node scripts/inspect-window.js <gatewayId> <fromIso> <toIso>
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');
const [gatewayId, from, to] = process.argv.slice(2);
const rows = db.prepare(
  'SELECT id, message_body, received_at, matched_request_id FROM sms_inbox WHERE gateway_id = ? AND received_at BETWEEN ? AND ? ORDER BY received_at'
).all(gatewayId, from, to);
for (const r of rows) {
  console.log(`${r.received_at}  matched=${r.matched_request_id || '(none)'}  ${JSON.stringify(r.message_body)}`);
}
