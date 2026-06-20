# Project Plan

Phased roadmap for the SMS Automation bridge. Architecture reference: `architecture.md`. Day-to-day checklist: `todo.md`.

**Status (June 2026):** Backend pipeline, Android gateway app **v1.2.1**, dashboard, training import, and test harness exist. **First full end-to-end device test PASSED** on 2026-06-11 (Samsung A55 + home PC). Phase 0 code-review fixes are done. See `progress_tracker.md` for session handoff.

---

## Phase 0 — Correctness fixes + first end-to-end test  *(do first)*

Defects found in code review; all are small, none require redesign.

| # | Defect | Where | Fix |
|---|--------|-------|-----|
| 0.1 | `apiKey` from `config/gateways.json` is **silently dropped** — `AutomationStore` constructor copies `gatewayUrl`/`sendPath`/`trustedSenders` but not `apiKey`, so `smsGateway.sendViaGateway` never sends the auth header | `src/store.js` constructor | Copy `apiKey` into the gateway record |
| 0.2 | Requester authorization is a **no-op**: `upsertUser` is called on every submit without role/operators, so defaults (`REQUESTER`, all operators) overwrite any restriction every time | `src/store.js` `upsertUser`, `src/service.js` | Preserve existing `role`/`allowedOperators` on upsert; only set defaults for new users |
| 0.3 | Timeout measured from `createdAt`, not send time — a request that waited in queue longer than the reply window times out the instant it's sent | `src/service.js` `timeoutWaitingRequests` | Use the outbox `sentAt` for that request/operator |
| 0.4 | **Queue stalls after timeout**: nothing calls `dispatchNext` when a request times out, so the next queued request waits until an unrelated submit/approve | `src/service.js` `timeoutWaitingRequests` | Dispatch next for each affected operator after marking TIMEOUT |
| 0.5 | Timeouts only run when `POST /api/timeouts/run` is called manually | `src/server.js` / `src/app.js` | `setInterval` sweep (e.g. every 30s) in the server |
| 0.6 | Request-ID sequence resets on restart → duplicate `REQ-YYYYMMDD-NNNN` same day | `src/store.js` | Interim: seed sequence from clock/persisted file; properly fixed by Phase 1 SQLite |
| 0.7 | Reply matching requires reply sender == SMS destination; operators replying from an alphanumeric sender ID will never match (only manual review) | `src/store.js` `findActiveRequestForGateway` | Fall back to trusted-sender + single-pending-on-gateway match |

**Also in Phase 0 (from `todo.md`):**
- [x] Verify Start Service works on-device (A55, v1.1.4+ / v1.2.1)
- [x] Complete first end-to-end test: app Test Request → manual reply → draft on dashboard (`REQ-20260610-0002-P94E`)
- [x] Confirm `config/gateways.json` has test reply numbers in `trustedSenders` (`01936759367`)
- [x] Backend auto-discovery + gateway registration (`POST /api/gateways/register`)
- [ ] SIM slot picker + SMS delivery callbacks (dual-SIM false-positive SENT)
- [ ] Re-validate E2E on office PC / different LAN

**Exit criteria:** ~~full test-mode loop works on real devices~~ **MET 2026-06-11**; `node --test` passes (18/18).

---

## Phase 1 — Persistence  *(DONE)*

- [x] Persist `AutomationStore` to SQLite via Node's built-in `node:sqlite` (zero native deps,
  not `better-sqlite3`). Write-through pattern: in-memory stays the live working set, every
  mutation write-throughs to disk, boot restores from disk. See `src/persistence.js`.
- [x] Restore request-ID sequence and per-operator waiting queues on startup; in-flight WAITING
  requests keep waiting with their original reply window and can still match their reply after a
  restart (`queue.rebuild()` + `app.recover()`).
- [x] Store interface kept stable — `service.js`/`queue.js`/`smsGateway.js` minimally changed;
  full suite runs against both in-memory (no `dbPath`) and SQLite.
- [x] `request_dispatches` table (per-operator status — architecture.md §5). One dispatch per
  target operator; request status is **derived** from dispatches: NEEDS_MANUAL_REVIEW once all
  dispatches terminal and ≥1 replied; TIMEOUT only when all timed out. Timeouts are per-dispatch,
  computed from each operator's own send time. Fan-out produces ONE combined draft (per-operator
  sections; timed-out/failed operators marked).
- Covered by `test/persistence.test.js` (restart recovery incl. dispatches, sequence continuity,
  durable audit log) and `test/workflow.test.js` (fan-out 2-reply/1-timeout → review; all-timeout → TIMEOUT).

DB lives at `data/automation.db` (override with `DB_PATH`; gitignored). WAL journal mode.

**Exit criteria:** ~~backend restart loses nothing~~ **MET** (in-flight request + dispatches survive
restart and still match their reply); ~~fan-out with one operator timing out and two replying
produces a correct combined state~~ **MET** (derived NEEDS_MANUAL_REVIEW + combined draft).

---

## Phase 2 — Security and access control  *(DONE, backend)*

- [x] **Admin API key** protects dashboard + admin API (`x-api-key` or `Authorization: Bearer`).
  Empty key = dev mode (auth off) for tests/local; set `adminApiKey` in `config/auth.json` (or
  `ADMIN_API_KEY`) for production. Dashboard prompts for the key and stores it. See `src/auth.js`.
- [x] **Per-gateway shared secret** on phone→backend webhook (`/api/sms/inbound`) and registration
  (`/api/gateways/register`): backend rejects unsigned posts (`x-gateway-secret`). Backend→phone
  `/send-sms` already sends `Authorization: Bearer <apiKey>` (phone-side enforcement is Android work).
  `requireGatewayAuth` strict mode rejects gateways with no configured secret.
- [x] **Deny-by-default users**: `denyUnknownRequesters` rejects unknown requesters with a clear
  message; DISABLED users always rejected. Admin user management: `GET/POST /api/users`,
  `POST /api/users/:id/status`, per-operator `allowedOperators`, roles. Secrets/apiKeys never
  leak in the dashboard snapshot.
- [x] **Tamper-evident audit log**: append-only, SHA-256 **hash-chained** (each row hashes the
  previous hash + its canonical content). `GET /api/audit/verify` detects edits/deletions;
  `GET /api/audit/export` returns CSV incl. the hash columns for case records.

Covered by `test/security.test.js` (10 tests: admin gate, gateway-secret gate, deny-unknown,
disabled user, strict mode, no-secret-leak, hash-chain verify/tamper/delete, CSV export).

Config: `config/auth.json` (gitignored; example in `config/auth.example.json`); gateway `secret`
in `config/gateways.json`. Remaining: phone-side rejection of unsigned `/send-sms` (Android).

**Exit criteria:** ~~an unauthenticated LAN device can neither inject inbound SMS nor trigger
sends~~ **MET**; ~~unknown requesters are rejected with a clear message~~ **MET**.

---

## Phase 3 — Reply extraction and review UX

- Structured field extractors per (operator × request type) using `data/reply-patterns.json` + real samples: MSISDN, NID, IMEI, IMSI, lat/long, cell/LAC, address, dates
- Extractor test suite generated from training-data rows; fill blank reply rows in the Excel files and re-import
- Combined draft for fan-out requests (one message with per-operator sections; missing operators marked)
- Dashboard review actions: reject, retry, manual match of unmatched inbox items, edit-before-approve
- Phone health: heartbeat from app (or backend polling `GET /health` on phone), online/offline + last-seen on dashboard, stale-queue alerting

**Exit criteria:** a reviewer can handle every outcome (good reply, garbled reply, unmatched SMS, timeout) entirely from the dashboard, and drafts show extracted fields above raw operator text.

---

## Phase 4 — Group channel integration (Telegram)

**Decision (2026-06-11):** the automation channel is **Telegram**, not WhatsApp. The official
WhatsApp Cloud API does not support group read/post, and unofficial WhatsApp Web automation is
rejected (ban risk + fragility). Telegram's Bot API officially supports group message read,
threaded reply, and user mention — with no companion phone and no ban risk.

Built (channel-agnostic backend + bridge scaffold, behind unit tests):

1. **Backend metadata plumbing** — requests/drafts carry `channel`, `chatId`, `sourceMessageId`,
   requester id; data model is channel-agnostic (`manual` keeps dashboard copy/paste).
2. **Two-step posting for automated channels** — Approve marks draft `APPROVED_FOR_POST` (request
   stays `NEEDS_MANUAL_REVIEW`); the bridge posts, then `POST /api/reply-drafts/:id/posted`
   completes the request. An unsent reply never looks completed and is retried.
3. **Telegram bridge** (`telegram-bridge/`, separate process) — long-poll intake (authorize
   deny-by-default → submit) + posting loop (threaded reply + real `text_mention` tag). Zero deps.
   See `docs/telegram-bridge.md`.

Remaining for production:
- Live bot setup (BotFather token, privacy mode off / admin, authorizedUsers by Telegram id)
- End-to-end test on a real group + gateway phone
- Optional: combined fan-out draft posting; optional auto-approve on HIGH confidence

Invariants preserved: requester tag, source chat identity, and manual-review gate.

**Exit criteria:** request intake no longer requires retyping; replies reach the group threaded
to the original request with the requester tagged; review gate still enforced.

---

## Phase 5 — Operations hardening

- Send retry with backoff for phone-gateway HTTP failures (instead of immediate FAILED)
- Battery-optimization exemption prompt in app (Samsung/Xiaomi service kills); boot-time auto-start verification
- **SIM slot / subscription selection** in Android app (dual-SIM phones — A55 incident 2026-06-11)
- **SMS sent-intent callbacks** so backend does not show SENT when carrier rejects
- Gateway config UI on dashboard (phone URLs, trusted senders) instead of hand-editing JSON
- Reporting: request history export, per-operator response-time stats, timeout rates
- Backups of the SQLite DB; log rotation
- Build hygiene: move keystore out of hardcoded `C:\BuildTools\` path, fix GitHub Actions APK build

---

## Risks

| Risk | Mitigation |
|------|------------|
| Operator replies from unexpected sender IDs | Fix 0.7 + keep `trustedSenders` configurable per gateway; unmatched → manual review, never dropped |
| Concurrent requests on one SIM cause mismatched replies | One-active-per-phone queue rule is load-bearing — never relax without a reliable reply reference |
| Android OEM kills the gateway service | Foreground service + battery exemption + heartbeat alerting (Phase 3/5) |
| Sensitive data exposure | LAN-only, auth in Phase 2, audit everywhere, manual review gate before group posting |
