'use strict';

// SQLite persistence layer using Node's built-in node:sqlite (synchronous, zero native deps).
// The AutomationStore keeps its in-memory structures as the live working set and write-throughs
// every mutation here; on boot it calls loadAll() to restore state. Complex fields (arrays,
// result/analysis objects) are stored as JSON TEXT.

const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS users (
  whatsapp_id TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL,
  allowed_operators TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gateways (
  id TEXT PRIMARY KEY,
  operator TEXT NOT NULL,
  operator_name TEXT,
  shortcode TEXT,
  gateway_url TEXT,
  send_path TEXT,
  api_key TEXT,
  trusted_senders TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  last_seen_at TEXT,
  registered_at TEXT
);
CREATE TABLE IF NOT EXISTS requests (
  request_id TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  whatsapp_group_id TEXT,
  requester_whatsapp_id TEXT,
  requester_name TEXT,
  channel TEXT,
  chat_id TEXT,
  source_message_id TEXT,
  operator TEXT NOT NULL,
  target_operators TEXT NOT NULL,
  request_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  silent_reference TEXT NOT NULL UNIQUE,
  raw_request_text TEXT,
  formatted_sms_text TEXT,
  received_operators TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  failed_reason TEXT,
  test_destination TEXT
);
CREATE TABLE IF NOT EXISTS request_dispatches (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  operator TEXT NOT NULL,
  gateway_id TEXT NOT NULL,
  status TEXT NOT NULL,
  outbox_id TEXT,
  inbox_id TEXT,
  sent_at TEXT,
  replied_at TEXT,
  UNIQUE (request_id, operator)
);
CREATE TABLE IF NOT EXISTS sms_outbox (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  gateway_id TEXT NOT NULL,
  operator TEXT NOT NULL,
  silent_reference TEXT,
  destination_number TEXT,
  message_body TEXT,
  sent_status TEXT NOT NULL,
  send_result TEXT,
  sent_at TEXT,
  claimed_at TEXT
);
CREATE TABLE IF NOT EXISTS sms_inbox (
  id TEXT PRIMARY KEY,
  gateway_id TEXT NOT NULL,
  sender_number TEXT,
  message_body TEXT,
  matched_request_id TEXT,
  analysis TEXT,
  received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS whatsapp_replies (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  reply_text TEXT,
  sent_status TEXT NOT NULL,
  channel TEXT,
  chat_id TEXT,
  source_message_id TEXT,
  requester_name TEXT,
  requester_id TEXT,
  posted_message_id TEXT,
  sent_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  request_id TEXT,
  timestamp TEXT NOT NULL,
  details TEXT NOT NULL,
  prev_hash TEXT,
  hash TEXT
);
`;

function j(value) {
  return JSON.stringify(value === undefined ? null : value);
}
function p(text, fallback) {
  if (text === null || text === undefined) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
function nz(value) {
  return value === undefined ? null : value;
}

class Persistence {
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
    // Migrate existing DBs that predate the claimed_at column.
    try { this.db.exec('ALTER TABLE sms_outbox ADD COLUMN claimed_at TEXT'); } catch (_) {}
  }

  close() {
    this.db.close();
  }

  setMeta(key, value) {
    this.db
      .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
      .run(key, String(value));
  }

  upsertUser(u) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO users
         (whatsapp_id, id, display_name, role, allowed_operators, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(u.whatsappId, u.id, nz(u.displayName), u.role, j(u.allowedOperators), u.status, u.createdAt);
  }

  upsertGateway(g) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO gateways
         (id, operator, operator_name, shortcode, gateway_url, send_path, api_key,
          trusted_senders, status, last_seen_at, registered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        g.id, g.operator, nz(g.operatorName), nz(g.shortcode), nz(g.gatewayUrl), nz(g.sendPath),
        nz(g.apiKey), j(g.trustedSenders), g.status, nz(g.lastSeenAt), nz(g.registeredAt)
      );
  }

  upsertRequest(r) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO requests
         (request_id, id, whatsapp_group_id, requester_whatsapp_id, requester_name, channel,
          chat_id, source_message_id, operator, target_operators, request_type, payload,
          silent_reference, raw_request_text, formatted_sms_text, received_operators, status,
          created_at, completed_at, failed_reason, test_destination)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        r.requestId, r.id, nz(r.whatsappGroupId), nz(r.requesterWhatsappId), nz(r.requesterName),
        nz(r.channel), nz(r.chatId), r.sourceMessageId === null || r.sourceMessageId === undefined
          ? null : String(r.sourceMessageId),
        r.operator, j(r.targetOperators), r.requestType, r.payload, r.silentReference,
        nz(r.rawRequestText), nz(r.formattedSmsText), j(r.receivedOperators), r.status,
        r.createdAt, nz(r.completedAt), nz(r.failedReason), nz(r.testDestination)
      );
  }

  upsertDispatch(d) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO request_dispatches
         (id, request_id, operator, gateway_id, status, outbox_id, inbox_id, sent_at, replied_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        d.id, d.requestId, d.operator, d.gatewayId, d.status,
        nz(d.outboxId), nz(d.inboxId), nz(d.sentAt), nz(d.repliedAt)
      );
  }

  updateOutboxStatus(outboxId, status, sendResult, claimedAt = undefined) {
    if (claimedAt !== undefined) {
      this.db
        .prepare('UPDATE sms_outbox SET sent_status = ?, send_result = ?, claimed_at = ? WHERE id = ?')
        .run(status, j(sendResult), claimedAt, outboxId);
    } else {
      this.db
        .prepare('UPDATE sms_outbox SET sent_status = ?, send_result = ? WHERE id = ?')
        .run(status, j(sendResult), outboxId);
    }
  }

  insertOutbox(row) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sms_outbox
         (id, request_id, gateway_id, operator, silent_reference, destination_number,
          message_body, sent_status, send_result, sent_at, claimed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id, row.requestId, row.gatewayId, row.operator, nz(row.silentReference),
        nz(row.destinationNumber), nz(row.messageBody), row.sentStatus, j(row.sendResult),
        nz(row.sentAt), nz(row.claimedAt)
      );
  }

  insertInbox(row) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sms_inbox
         (id, gateway_id, sender_number, message_body, matched_request_id, analysis, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id, row.gatewayId, nz(row.senderNumber), nz(row.messageBody),
        nz(row.matchedRequestId), j(row.analysis), row.receivedAt
      );
  }

  upsertWhatsAppReply(row) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO whatsapp_replies
         (id, request_id, reply_text, sent_status, channel, chat_id, source_message_id,
          requester_name, requester_id, posted_message_id, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id, row.requestId, nz(row.replyText), row.sentStatus, nz(row.channel), nz(row.chatId),
        row.sourceMessageId === null || row.sourceMessageId === undefined ? null : String(row.sourceMessageId),
        nz(row.requesterName), nz(row.requesterId),
        row.postedMessageId === null || row.postedMessageId === undefined ? null : String(row.postedMessageId),
        nz(row.sentAt)
      );
  }

  insertAudit(row) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO audit_logs
         (id, actor, action, request_id, timestamp, details, prev_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id, row.actor, row.action, nz(row.requestId), row.timestamp, j(row.details),
        nz(row.prevHash), nz(row.hash)
      );
  }

  loadAll() {
    const all = (sql) => this.db.prepare(sql).all();
    const meta = {};
    for (const m of all('SELECT key, value FROM meta')) meta[m.key] = m.value;

    return {
      meta,
      users: all('SELECT * FROM users ORDER BY rowid').map((u) => ({
        id: u.id,
        whatsappId: u.whatsapp_id,
        displayName: u.display_name,
        role: u.role,
        allowedOperators: p(u.allowed_operators, []),
        status: u.status,
        createdAt: u.created_at
      })),
      gateways: all('SELECT * FROM gateways ORDER BY rowid').map((g) => ({
        id: g.id,
        operator: g.operator,
        operatorName: g.operator_name,
        shortcode: g.shortcode,
        gatewayUrl: g.gateway_url || '',
        sendPath: g.send_path || '/send-sms',
        apiKey: g.api_key || '',
        trustedSenders: p(g.trusted_senders, []),
        status: g.status,
        lastSeenAt: g.last_seen_at,
        registeredAt: g.registered_at || undefined
      })),
      requests: all('SELECT * FROM requests ORDER BY rowid').map((r) => ({
        id: r.id,
        requestId: r.request_id,
        whatsappGroupId: r.whatsapp_group_id,
        requesterWhatsappId: r.requester_whatsapp_id,
        requesterName: r.requester_name,
        channel: r.channel,
        chatId: r.chat_id,
        sourceMessageId: r.source_message_id,
        operator: r.operator,
        targetOperators: p(r.target_operators, []),
        requestType: r.request_type,
        payload: r.payload,
        silentReference: r.silent_reference,
        rawRequestText: r.raw_request_text,
        formattedSmsText: r.formatted_sms_text,
        receivedOperators: p(r.received_operators, []),
        status: r.status,
        createdAt: r.created_at,
        completedAt: r.completed_at,
        failedReason: r.failed_reason,
        testDestination: r.test_destination
      })),
      dispatches: all('SELECT * FROM request_dispatches ORDER BY rowid').map((d) => ({
        id: d.id,
        requestId: d.request_id,
        operator: d.operator,
        gatewayId: d.gateway_id,
        status: d.status,
        outboxId: d.outbox_id,
        inboxId: d.inbox_id,
        sentAt: d.sent_at,
        repliedAt: d.replied_at
      })),
      smsOutbox: all('SELECT * FROM sms_outbox ORDER BY rowid').map((o) => ({
        id: o.id,
        requestId: o.request_id,
        gatewayId: o.gateway_id,
        operator: o.operator,
        silentReference: o.silent_reference,
        destinationNumber: o.destination_number,
        messageBody: o.message_body,
        sentStatus: o.sent_status,
        sendResult: p(o.send_result, null),
        sentAt: o.sent_at,
        claimedAt: o.claimed_at || null
      })),
      smsInbox: all('SELECT * FROM sms_inbox ORDER BY rowid').map((i) => ({
        id: i.id,
        gatewayId: i.gateway_id,
        senderNumber: i.sender_number,
        messageBody: i.message_body,
        matchedRequestId: i.matched_request_id,
        analysis: p(i.analysis, null),
        receivedAt: i.received_at
      })),
      whatsappReplies: all('SELECT * FROM whatsapp_replies ORDER BY rowid').map((w) => ({
        id: w.id,
        requestId: w.request_id,
        replyText: w.reply_text,
        sentStatus: w.sent_status,
        channel: w.channel,
        chatId: w.chat_id,
        sourceMessageId: w.source_message_id,
        requesterName: w.requester_name,
        requesterId: w.requester_id,
        postedMessageId: w.posted_message_id,
        sentAt: w.sent_at
      })),
      auditLogs: all('SELECT * FROM audit_logs ORDER BY rowid').map((a) => ({
        id: a.id,
        actor: a.actor,
        action: a.action,
        requestId: a.request_id,
        timestamp: a.timestamp,
        details: p(a.details, {}),
        prevHash: a.prev_hash || '',
        hash: a.hash || ''
      }))
    };
  }
}

module.exports = { Persistence };
