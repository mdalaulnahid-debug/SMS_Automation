-- Wired SQLite schema for the SMS automation backend (Phase 1).
-- This mirrors the tables created at runtime by src/persistence.js (the source of truth);
-- it is kept here for reference and manual inspection. Complex fields (arrays, send/analysis
-- results, audit details) are stored as JSON TEXT. The DB lives at data/automation.db by
-- default (override with DB_PATH); the store loads it on boot and write-throughs every change.

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT                         -- e.g. sequence, referenceSequence (restored on boot)
);

CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,      -- Telegram user ID (string form of integer)
  id TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL,
  allowed_operators TEXT NOT NULL,   -- JSON array
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gateways (
  id TEXT PRIMARY KEY,               -- e.g. GP_PHONE_01
  operator TEXT NOT NULL,            -- GP | ROBI | BANGLALINK
  operator_name TEXT,
  shortcode TEXT,
  gateway_url TEXT,                  -- runtime-registered phone URL; restored across restarts
  send_path TEXT,
  api_key TEXT,
  trusted_senders TEXT NOT NULL DEFAULT '[]',  -- JSON array (config wins over DB on boot)
  status TEXT NOT NULL,
  last_seen_at TEXT,
  registered_at TEXT
);

CREATE TABLE IF NOT EXISTS requests (
  request_id TEXT PRIMARY KEY,       -- REQ-YYYYMMDD-NNNN-XXXX
  id TEXT NOT NULL,
  requester_id TEXT,                 -- Telegram user ID of the requester
  requester_name TEXT,
  channel TEXT,                      -- manual | telegram
  chat_id TEXT,                      -- source chat (Telegram group id)
  source_message_id TEXT,            -- message to reply to when posting back
  operator TEXT NOT NULL,
  target_operators TEXT NOT NULL,    -- JSON array (fan-out)
  request_type TEXT NOT NULL,        -- LRL | LCL | MS-NID | NID-MS | IMEI-MS
  payload TEXT NOT NULL,
  silent_reference TEXT NOT NULL UNIQUE,
  raw_request_text TEXT,
  formatted_sms_text TEXT,
  received_operators TEXT NOT NULL DEFAULT '[]',  -- JSON array of operators that replied
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  failed_reason TEXT,
  test_destination TEXT
);

-- Per-operator dispatch for fan-out requests (architecture.md §5). Request status is DERIVED
-- from these: NEEDS_MANUAL_REVIEW once all dispatches terminal and >=1 replied; TIMEOUT only if
-- all timed out. Timeouts are computed per-dispatch from the linked outbox sent_at.
CREATE TABLE IF NOT EXISTS request_dispatches (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  operator TEXT NOT NULL,            -- GP | ROBI | BANGLALINK
  gateway_id TEXT NOT NULL,
  status TEXT NOT NULL,              -- QUEUED | WAITING_REPLY | REPLY_RECEIVED | TIMEOUT | FAILED
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
  sent_status TEXT NOT NULL,         -- SENT | FAILED
  send_result TEXT,                  -- JSON
  sent_at TEXT,
  claimed_at TEXT
);

CREATE TABLE IF NOT EXISTS sms_inbox (
  id TEXT PRIMARY KEY,
  gateway_id TEXT NOT NULL,
  sender_number TEXT,
  message_body TEXT,
  matched_request_id TEXT,
  analysis TEXT,                     -- JSON (null if unmatched/ignored)
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reply_drafts (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  reply_text TEXT,
  sent_status TEXT NOT NULL,         -- DRAFT | APPROVED_FOR_POST | POSTED
  channel TEXT,
  chat_id TEXT,
  source_message_id TEXT,
  requester_name TEXT,
  requester_id TEXT,
  posted_message_id TEXT,            -- set by the posting bridge after delivery
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  request_id TEXT,
  timestamp TEXT NOT NULL,
  details TEXT NOT NULL              -- JSON
);
