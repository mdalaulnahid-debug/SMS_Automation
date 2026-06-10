CREATE TABLE users (
  id TEXT PRIMARY KEY,
  whatsapp_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  allowed_operators TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL
);

CREATE TABLE operator_gateways (
  id TEXT PRIMARY KEY,
  operator_name TEXT NOT NULL UNIQUE,
  phone_number TEXT,
  gateway_url TEXT,
  trusted_senders TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'OFFLINE',
  last_seen_at TEXT
);

CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  whatsapp_group_id TEXT NOT NULL,
  requester_whatsapp_id TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  operator TEXT NOT NULL,
  target_operators TEXT NOT NULL,
  request_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  silent_reference TEXT NOT NULL UNIQUE,
  raw_request_text TEXT NOT NULL,
  formatted_sms_text TEXT,
  received_operators TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  failed_reason TEXT
);

CREATE TABLE sms_outbox (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(request_id),
  gateway_id TEXT NOT NULL REFERENCES operator_gateways(id),
  operator TEXT NOT NULL,
  silent_reference TEXT NOT NULL,
  destination_number TEXT NOT NULL,
  message_body TEXT NOT NULL,
  sent_status TEXT NOT NULL,
  send_result TEXT,
  sent_at TEXT
);

CREATE TABLE sms_inbox (
  id TEXT PRIMARY KEY,
  gateway_id TEXT NOT NULL REFERENCES operator_gateways(id),
  sender_number TEXT NOT NULL,
  message_body TEXT NOT NULL,
  matched_request_id TEXT REFERENCES requests(request_id),
  analysis TEXT,
  received_at TEXT NOT NULL
);

CREATE TABLE whatsapp_replies (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(request_id),
  reply_text TEXT NOT NULL,
  sent_status TEXT NOT NULL,
  sent_at TEXT
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  request_id TEXT,
  timestamp TEXT NOT NULL,
  details TEXT NOT NULL
);
