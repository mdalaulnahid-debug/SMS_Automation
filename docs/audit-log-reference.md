# Audit Log Reference

Every audit row has an **actor** (who/what logged it) and an **action** (what happened),
plus an optional `requestId` and a `details` object. The log is append-only and
SHA-256 hash-chained — see `GET /api/audit/verify` and `architecture.md` §11.

This reference covers the action codes and actors you'll see in the admin
console's Audit tab.

## Request lifecycle (`REQUEST_*`)

A request moves through one status at a time. Most of these are generated
automatically by `store.updateRequestStatus()` as `REQUEST_<STATUS>` — logged
by `src/store.js`.

| Code | Meaning |
|---|---|
| `REQUEST_RECEIVED` | A new request just came in (Telegram group or DM) and was recorded. |
| `REQUEST_VALIDATED` | Passed format/authorization checks (valid command, requester allowed). |
| `REQUEST_QUEUED` | Sitting in the per-operator FIFO queue, waiting for the gateway phone to be free. |
| `REQUEST_OPERATOR_TARGETED` | The system decided which operator(s) (GP/Robi/Banglalink) this request routes to. |
| `REQUEST_SMS_SENT` | The SMS was handed off to the gateway phone to send. |
| `REQUEST_WAITING_OPERATOR_REPLY` | Sent successfully; now waiting for the operator's SMS reply. |
| `REQUEST_REPLY_RECEIVED` | A reply arrived and was matched to this request. |
| `REQUEST_NEEDS_MANUAL_REVIEW` | All dispatches are done (replied/timed out); a combined draft was assembled and is waiting for a human to approve it. |
| `REQUEST_REPLY_POSTED` | The approved reply has been posted (status-side bookkeeping; distinct from the bridge's own `REPLY_POSTED` below). |
| `REQUEST_COMPLETED` | Fully done — reply delivered, lifecycle closed. |
| `REQUEST_TIMEOUT` | No operator reply arrived within the reply window. |
| `REQUEST_FAILED` | A dispatch failed outright (send error, not a timeout). |
| `REQUEST_REJECTED` | An admin manually rejected the request. |
| `REQUEST_RETRIED` | An admin re-queued a failed/timed-out request. |
| `REQUEST_PARTIAL_OPERATOR_REPLY` | Multi-operator fan-out: one operator replied, others still pending. |
| `REQUEST_REVIVED_AFTER_TIMEOUT` | A reply arrived late (after timeout) and the request was reopened to capture it. |
| `REQUEST_LATE_OPERATOR_REPLY` | A reply arrived after the request was already finalized to `NEEDS_MANUAL_REVIEW`; the combined draft was regenerated. |
| `REQUEST_DUPLICATE_BLOCKED` | Rejected as a duplicate of a recent identical request. |
| `REQUEST_DENIED_DISABLED_USER` / `REQUEST_DENIED_UNKNOWN_USER` / `REQUEST_DENIED_UNAUTHORIZED_OPERATOR` | Rejected at the authorization layer — requester is disabled, unknown, or not allowed to query that operator. |
| `REQUEST_VALIDATION_FAILED` | Rejected — malformed command/identifier. |

## Reply handling (`REPLY_*`)

| Code | Meaning |
|---|---|
| `REPLY_DRAFTED` | A reply draft was created from a matched operator SMS (not yet approved/posted). |
| `REPLY_AUTO_APPROVED` | For auto-approve channels (Telegram), the draft skipped manual review and went straight to "ready to post." |
| `REPLY_APPROVED_FOR_POST` | An admin manually approved a draft for posting. |
| `REPLY_POSTED` | The Telegram bridge confirmed it successfully posted the reply message. |
| `REPLY_LIVE_POSTED` | First partial post for a multi-operator fan-out (GP replied, others still pending). |
| `REPLY_EDITED` | The bridge edited an already-posted live message with newly arrived operator data. |

## SMS plumbing (`SMS_*`)

| Code | Meaning |
|---|---|
| `SMS_OUTBOUND` | The backend logged an SMS job handed to a gateway phone to send. |
| `SMS_SENT_CONFIRMED` | The gateway phone confirmed the SMS actually left the device. |
| `SMS_SEND_FAILED` | The gateway phone reported the send failed. |
| `SMS_INBOUND` | Any SMS arriving at a gateway phone (matched or not) was recorded. |
| `SMS_REPLY_UNMATCHED` | An inbound SMS couldn't be tied to any open request — flagged for manual review. |
| `SMS_REPLY_AMBIGUOUS` | Multiple pending requests were plausible candidates and none scored uniquely best — left unmatched rather than guessing. |
| `SMS_REPLY_TYPE_MISMATCH` | A reply's inferred type (e.g. IMEI) didn't match the pending request's type (e.g. LRL) — rejected rather than wrongly matched. |
| `SMS_INBOUND_DUPLICATE_IGNORED` | A retried/duplicate inbound webhook was recognized and ignored (idempotency). |
| `SMS_IGNORED_UNTRUSTED_SENDER` | An inbound SMS arrived from a sender not in the gateway's trusted-sender list. |
| `SMS_DELIVERY_STATUS` | Lower-level delivery-result callback from the phone (sent/delivered/failed code). |
| `SMS_JOB_RECLAIMED` | An outbox job stuck claimed-but-unconfirmed was reclaimed for retry. |

## Manual correction & admin actions

| Code | Meaning |
|---|---|
| `MANUAL_MATCH` | An admin manually attached an unmatched reply to a waiting request. |
| `MANUAL_REMATCH_CORRECTION` | An admin re-attached a reply to a request that was already finalized (e.g. `COMPLETED`) — corrects a previously wrong auto-match. See `architecture.md` §8 and the 2026-06-20 incident in `progress_tracker.md`. |
| `DISPATCH_TIMEOUT` | A per-operator dispatch hit its reply-window deadline. |
| `SETTINGS_TELEGRAM_GROUP_UPDATED` / `SETTINGS_OPERATOR_CONTACT_UPDATED` | Telegram group ID or operator hotline number changed via the admin console/app. |
| `SETTINGS_AUTHORIZED_USER_ADDED` / `SETTINGS_AUTHORIZED_USER_REMOVED` | Telegram private-DM allowlist changed. |
| `USER_UPSERTED` / `USER_STATUS_CHANGED` | Requester user record created/edited or enabled/disabled. |
| `APP_UPDATE_PUBLISHED` | A new Android gateway APK was published via the Admin Panel. |

## Telegram bridge safeguards

| Code | Meaning |
|---|---|
| `TELEGRAM_CHAT_MISMATCH` | A message arrived from a chat that isn't the configured group — surfaced once per distinct wrong chat. |
| `TELEGRAM_UNAUTHORIZED_ATTEMPT` | A sender not on the authorized list tried to submit a request (group, if an allowlist is configured, or any private DM). |

## Security

| Code | Meaning |
|---|---|
| `UNAUTHORIZED_SMS_SEND` | A gateway phone sent an SMS that the backend never dispatched (e.g. a manual send directly from the phone) — flagged by the Android-side `SmsWatchdog`. |

## Actors

The actor field identifies *which component* logged the event, not a person's name.

| Actor | Represents |
|---|---|
| `system` | The backend's own logic engine — state transitions, request validation, reply matching/scoring. |
| `sms-gateway` | The backend's SMS dispatch/inbox subsystem — recording outbound jobs and inbound SMS as they move through the pipeline. |
| `gateway` | The Android gateway phone itself, reporting back to the backend (e.g. delivery-status callbacks). |
| `operator` | A human reviewer/admin action on a reply — drafting, approving for posting. (Not the telecom operator — that's a separate `operator` field inside an event's `details`, e.g. `GP`/`ROBI`.) |
| `bridge` | The Telegram bridge process — confirming it posted/edited a message in the chat. |
| `telegram-bridge` | The Telegram bridge reporting a chat-mismatch or unauthorized-attempt safeguard event. |
| `watchdog` | The Android `SmsWatchdog` component, monitoring the phone's own sent-SMS log for sends the backend didn't authorize. |
| `admin` | A direct action taken by a human through the console or Admin App (settings changes, manual match/correction, reject/retry, user management). |

## Source

Generated from a grep of every `store.audit(...)` call site across `src/`.
If you add a new audit action, add a row here in the same pass.
