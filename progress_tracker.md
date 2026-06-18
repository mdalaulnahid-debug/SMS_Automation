# Progress Tracker

Last updated: **2026-06-18 - Multi-number batching live; reply-window/heartbeat hardening; docs reconciled**

---

## Current Stage

**Backend and production operator flow remain live. Multi-number batching (up to 5 identifiers per request, official rule sheet compliant) is implemented and deployed. Reply-window timeouts now anchor on actual carrier-confirmed send time, gateway heartbeat is decoupled from job polling, and the separate Android admin app still remains mid-redesign.**

Git and the live VPS (`https://licbarishal.duckdns.org`) are both current through commit `c26b896` on `main` — verified directly against the live API, not assumed from docs.

## Documentation Baseline

Before new coding work, treat these Markdown files as the continuity baseline:

- `README.md`
- `progress_tracker.md`
- `docs/CHANGELOG-2026-06-18.md`
- `docs/system-design-v2.md`
- `docs/ui-design-guide-v2.md`
- `docs/Design/android-admin-stitch/README.md`
- `docs/Design/android-admin-stitch/DESIGN.md`

Important portability note:

- pulling from Git is enough to continue code, UI, and docs work
- running the full system on another PC still requires restoring `config/auth.json`, `config/gateways.json`, and `config/telegram.json`
- local `data/automation.db` is not auto-synced between PCs

---

## Session Handoff (2026-06-18) - Read This First

### What was accomplished this session

Backend intake / batching (commits `8bd26a5`, `c26b896`):

| Item | Status | Notes |
|------|--------|-------|
| Multi-number batching | Done | `LRL`/`LCL`/`MS-NID`/`NID-MS`/`IMEI-MS` all accept 1-5 identifiers; canonical dispatch text built by `src/parser.js` |
| Same-operator batch enforcement | Done | `LCL`, `LRL`, `MS-NID` reject mixed-operator batches (`OPERATOR_MISMATCH`) instead of routing ambiguously |
| Structured validation errors | Done | 11 distinct `errorCode`s with specific `replyText` per failure mode — see `docs/multi-number-batching-plan.md` |
| Invalid request audit visibility | Done | Validation failures write `REQUEST_VALIDATION_FAILED` audit events; never enter the queue or reach a gateway phone |
| Batch reply collection | Done | An operator replying once per number (not one combined SMS) is now fully captured — `collectDispatchReplyMessages()` in `service.js` |
| Type-token auto-correct (`MS NID` → `MS-NID` etc.) | **Not implemented** | Originally planned, deliberately not shipped — strict rejection only. See "Decision that changed" in `docs/multi-number-batching-plan.md` |

Reply-window / gateway-health hardening (commits `cbb2d4f`, `a76d988`, `b3bc890`):

| Item | Status | Notes |
|------|--------|-------|
| Reply-window clock anchored on carrier confirmation | Done | Starts from `sendResult.confirmedAt` (the ack), not queue time — 15 min window (`DEFAULT_REPLY_WINDOW_MS`) |
| Send-confirmation grace period | Done | A separate, shorter timeout covers claimed-but-not-yet-acked jobs so a stalled phone can't hang a request forever |
| Duplicate-request blocking | Done | Identical request (same type/payload/operators) within 30 min returns `DUPLICATE_ACTIVE_REQUEST` instead of double-dispatching |
| Dedicated gateway heartbeat | Done | `POST /api/gateway/heartbeat`, called every 30s from the Android poll loop — keeps `lastSeenAt` fresh even with zero pending jobs |
| Poll-thread watchdog restart fix | Done | `GatewayForegroundService.kt` |
| New admin diagnostics | Done | `delayedConfirmations`, `ambiguousReplies24h`, `duplicateRiskGroups` on `/api/dashboard`, surfaced in web admin Overview + Audit tabs |

Docs reconciliation (this pass):

| Item | Status | Notes |
|------|--------|-------|
| `docs/multi-number-batching-plan.md` | Rewritten | Was a pre-implementation plan; now documents actual shipped behavior + the auto-correct deviation |
| `docs/PHONE_GATEWAY_CONTRACT.md` | Rewritten | Was describing a dead "push" send model (`POST phone/send-sms`); now documents the real poll-based contract (`GET /api/gateway/jobs`, ack, heartbeat) |
| `README.md` request-type table | Fixed earlier this session | `MS-NID` was wrongly documented as broadcasting to all operators |
| `progress_tracker.md`, `docs/CHANGELOG-2026-06-18.md` | Reconciled | Previous entries referenced an "uncommitted" state at commit `c1582c5`; both files are now current through `c26b896`, with the VPS confirmed at the same commit |

### Current caution

- The type-token auto-correct decision from earlier in the day was **not** carried through to the implementation — confirm whether that's intentional going forward or still wanted.
- The Android admin app is functional and connected, but the UI still needs another fidelity pass to better match the Stitch references.
- `data/reply-patterns.json` changes on every test run (learned-keyword counts) — expect it to show as modified locally; don't read that as a real change.

### Important files for the current session

- `src/parser.js`, `src/domain.js`, `src/service.js`, `src/store.js`, `src/app.js`
- `android-gateway/app/src/main/java/com/smsgateway/GatewayForegroundService.kt`, `BackendClient.kt`
- `test/workflow.test.js`, `test/security.test.js`
- `docs/multi-number-batching-plan.md`, `docs/PHONE_GATEWAY_CONTRACT.md`

### Current versions

| Surface | State | Notes |
|---------|-------|-------|
| Backend | Live, verified at commit `c26b896` | Multi-number batching, hardened timeouts, gateway heartbeat all confirmed live against `https://licbarishal.duckdns.org` |
| Android gateway app | Live | Heartbeat + watchdog-restart fixes shipped; new icon from earlier in the session |
| Android admin app | Debug build active | Separate supervisor app with live API integration; theme synced to Gateway App; redesign still in progress |

### Deployment / continuity notes

- GitHub `main` and the production VPS are both at `c26b896` — confirmed by hitting `/api/dashboard` and submitting test requests directly against the live API, not assumed from a doc.
- VPS update procedure (when a future commit needs pushing): `scp` the changed `src/*.js` files to `/opt/sms-backend/src/` then `ssh ... "pm2 restart sms-backend"` — see `scripts/deploy.sh` for the full-surface version.

### Recommended next step

1. Decide on the type-token auto-correct question (see "Current caution" above) and either implement it or close it out as won't-do.
2. Surface `REQUEST_VALIDATION_FAILED` and the new diagnostics counters more prominently in the web/admin audit experience.
3. Continue Android admin UI refinement against Stitch references.
4. Then modernize web admin and web operations UI around the now-stable intake contract.

---

## Environment

| Component | Location | Notes |
|-----------|----------|-------|
| Backend | `45.77.240.195:3000` | Vultr Singapore VPS |
| Public host | `https://licbarishal.duckdns.org` | Admin API reachable here |
| Admin phone | Samsung A55 (`RRCXA03MTRA`) | Android admin app tested and installed over USB |
| Gateway phones | Existing production phones | Left unchanged in this session |

### VPS credentials

See `config/vps.md` (gitignored).

---

## Completed (Cumulative)

### Backend

- Structured request validation, operator routing, per-operator queues
- Canonical dispatch message generation
- Audit-visible validation failures that do not enter queue/outbox
- Trusted-sender filter and reply matching
- Dashboard review actions (reject, retry, manual match)
- SQLite persistence
- Admin API key, gateway secrets, audit chain
- Telegram bridge integration
- VPS deployment with PM2

### Android Gateway App

- NanoHTTPD, SMS send/receive, webhook, retry, Room DB
- Foreground service, boot receiver, permissions flow
- SIM picker and dual-SIM support
- OTA update checker and installer

### Android Admin App

- Separate app from the gateway APK
- Live overview, approvals, gateways, incidents, and audit surfaces
- Saved backend URL and admin API key connectivity
- Command-center theme primitives and drawables
- Dedicated settings surface
- Custom bottom nav icons and compact tags

---

## Next Milestone

1. Increase Android admin app visual fidelity against the Stitch package
2. Refine nav, rows, and per-screen modules so the app feels less boxy
3. Surface backend validation failures more clearly in admin/web audit views
4. Sync VPS backend with latest `main` if still behind
5. Resume V2 work on web admin and web operations surfaces
