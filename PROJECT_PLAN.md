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

## Phase 1 — Persistence

- Replace in-memory `AutomationStore` with SQLite (`better-sqlite3`), starting from `db/schema.sql`
- Add `request_dispatches` table (per-operator status for fan-out requests — see `architecture.md` §5) and derive request status from dispatches
- Restore request-ID sequence and pending queues from DB on startup; recover in-flight requests safely (anything WAITING at boot keeps waiting, with its original reply window)
- Keep the store interface stable so `service.js`/`queue.js` change minimally; run the existing test suite against the SQLite store

**Exit criteria:** backend restart loses nothing; fan-out request with one operator timing out and two replying produces a correct combined state.

---

## Phase 2 — Security and access control

- Shared-secret auth: per-gateway key on phone→backend webhook **and** backend→phone `/send-sms` (phone rejects unsigned sends; backend rejects unsigned webhooks)
- Admin authentication on dashboard/API (single admin login or API key is enough at this scale)
- Real user management: deny-by-default for unknown WhatsApp IDs, roles, per-operator permissions, enable/disable users from dashboard (depends on fix 0.2)
- Persistent append-only audit log with export (CSV/Excel)

**Exit criteria:** an unauthenticated LAN device can neither inject inbound SMS nor trigger sends; unknown requesters are rejected with a clear message.

---

## Phase 3 — Reply extraction and review UX

- Structured field extractors per (operator × request type) using `data/reply-patterns.json` + real samples: MSISDN, NID, IMEI, IMSI, lat/long, cell/LAC, address, dates
- Extractor test suite generated from training-data rows; fill blank reply rows in the Excel files and re-import
- Combined draft for fan-out requests (one message with per-operator sections; missing operators marked)
- Dashboard review actions: reject, retry, manual match of unmatched inbox items, edit-before-approve
- Phone health: heartbeat from app (or backend polling `GET /health` on phone), online/offline + last-seen on dashboard, stale-queue alerting

**Exit criteria:** a reviewer can handle every outcome (good reply, garbled reply, unmatched SMS, timeout) entirely from the dashboard, and drafts show extracted fields above raw operator text.

---

## Phase 4 — WhatsApp integration

Keep manual posting until this phase. Then, in order of preference:

1. **Official WhatsApp Business Platform** — evaluate eligibility for group messaging with your number setup; if available, automate intake (parse group messages) and posting (tagged replies) through the official API
2. **Semi-automated** — dashboard "Copy for WhatsApp" formatting (already close), plus a notification when a draft is approved so posting is one paste
3. Unofficial WhatsApp Web automation: **rejected** — ban risk and fragility are unacceptable for this workflow

Whatever the mechanism: requester tag, group identity, and manual-review gate are preserved.

**Exit criteria:** request intake no longer requires retyping; replies reach the group with the original requester tagged; review gate still enforced.

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
| WhatsApp policy limits | Manual posting is the safe default; official API only after eligibility confirmed |
| Sensitive data exposure | LAN-only, auth in Phase 2, audit everywhere, manual review gate before group posting |
