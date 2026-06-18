# Progress Tracker

Last updated: **2026-06-18 - Backend intake v2 validation implemented**

---

## Current Stage

**Backend and production operator flow remain live. Backend intake validation is now hardened and canonicalized before queueing, and the separate Android admin app still remains mid-redesign.**

Git is current through local commit `c1582c5` on `main` before the latest uncommitted backend validation/doc updates.

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

| Item | Status | Notes |
|------|--------|-------|
| Backend intake validator v2 | Done | Parser now returns structured validation result with canonical request text and normalized failures |
| Canonical dispatch message generation | Done | Valid requests now dispatch normalized `COMMAND identifier1 ...` text instead of preserving messy spacing |
| Same-operator batch enforcement | Done | `LCL`, `LRL`, and `MS-NID` now reject mixed-operator batches instead of routing ambiguously |
| Invalid request audit visibility | Done | Validation failures now write `REQUEST_VALIDATION_FAILED` audit events with raw text and reason |
| Backend regression coverage | Done | Parser acceptance/rejection cases and queue-blocking integration test added |
| Android gateway app changes | Not done by design | This slice intentionally left gateway runtime untouched |
| Android admin UI polish | Deferred | Validation slice completed first, per architecture rule |

### Current caution

- Telegram/web/mobile callers should now rely on normalized backend validation failures instead of assuming only a generic parse error.
- The Android admin app is functional and connected, but the UI still needs another fidelity pass to better match the Stitch references.
- There is still a local uncommitted change in `data/reply-patterns.json`; do not overwrite it casually during later work.

### Important files for the current session

- `src/parser.js`
- `src/service.js`
- `src/domain.js`
- `test/workflow.test.js`
- `README.md`
- `docs/system-design-v2.md`
- `docs/CHANGELOG-2026-06-18.md`

### Current versions

| Surface | State | Notes |
|---------|-------|-------|
| Backend | Live with stronger intake guardrails | Request format is validated before queueing or dispatch; invalid requests are audit-visible and never sent to phones |
| Android gateway app | Existing | Not reworked in this session |
| Android admin app | Debug build active | Separate supervisor app with live API integration and redesign in progress |

### Deployment / continuity notes

- GitHub `main` includes the latest admin app redesign commit: `ad76496`
- The VPS backend was not updated in the final step from this workstation because direct SSH auth failed here
- Safe VPS update commands are recorded in `docs/CHANGELOG-2026-06-18.md`

### Recommended next step

1. Surface `REQUEST_VALIDATION_FAILED` events clearly in the web/admin audit experience
2. Continue Android admin UI refinement against Stitch references
3. Then modernize web admin and web operations UI around the now-stable intake contract

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
