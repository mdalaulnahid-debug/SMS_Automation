# Progress Tracker

Last updated: **2026-06-19 — Auto-correct, specific errors, multi-op reply fix deployed**

---

## Current Stage

**Backend and production operator flow remain live. This session added three intake improvements: (1) auto-correct for common typos (split commands, glued prefixes, `+880` country code, separator stripping), (2) specific validation error messages that diagnose the mistake (NID/IMEI/MSISDN cross-detection, digit counts, strict NID 10/13/17 and IMEI 14/15 lengths), and (3) multi-operator replies now post as separate Telegram messages instead of editing the previous one in-place.**

Git and the live VPS (`https://licbarishal.duckdns.org`) are both current through this session's commit on `main`.

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

## Session Handoff (2026-06-19) - Read This First

### What was accomplished this session

Intake auto-correct and specific error messages:

| Item | Status | Notes |
|------|--------|-------|
| Auto-correct split commands | Done | `MS NID` → `MS-NID`, `NID MS` → `NID-MS`, `IMEI MS` → `IMEI-MS` |
| Auto-correct glued prefixes | Done | `LRL01308218563` → `LRL 01308218563`, `MSNID01625242040` → `MS-NID 01625242040` |
| Auto-correct command separators | Done | `LRL-01718000000`, `LRL:01718000000` → `LRL 01718000000` |
| Strip `+880`/`880` country code | Done | `+8801712345678` → `01712345678`, `8801712345678` → `01712345678` |
| Strip separators in identifiers | Done | Hyphens, colons, underscores, commas, dots stripped from numbers (e.g. `01718-000000` → `01718000000`) |
| Case-insensitive commands | Done | `lrl`, `Ms-Nid` etc. all accepted (was already working via `.toUpperCase()`) |
| Specific validation errors | Done | Each error now tells the user exactly what's wrong — see table below |
| Strict NID lengths | Done | NID must be exactly 10 (smart NID), 13, or 17 (old NID with birth year) digits. Was 10-17 range. |
| Strict IMEI lengths | Done | IMEI must be exactly 14 (no check digit) or 15 (with check digit) digits. Was 14-17 range. |
| Cross-type detection | Done | If you send a phone number where NID is expected (or IMEI where NID is expected, etc.), the error says what it looks like and what was expected |

Specific error messages now returned (examples):

| Mistake | Error reply |
|---------|------------|
| `LRL 0171234` (too few digits) | `"0171234" is too short (7 digits). Phone numbers must be 11 digits starting with 01.` |
| `LRL 4246780000` (NID in phone slot) | `"4246780000" looks like an NID (10 digits), not a phone number. LRL requires an 11-digit mobile number starting with 01.` |
| `NID-MS 01712345678` (phone in NID slot) | `"01712345678" looks like a phone number, not an NID. NID-MS requires an NID (10, 13, or 17 digits).` |
| `IMEI-MS 01712345678` (phone in IMEI slot) | `"01712345678" looks like a phone number, not an IMEI. IMEI-MS requires a 14 or 15 digit IMEI.` |
| `NID-MS 35391109000000` (IMEI in NID slot) | `"35391109000000" looks like an IMEI (14 digits), not an NID.` |
| `IMEI-MS 4246780000` (NID in IMEI slot) | `"4246780000" looks like an NID (10 digits), not an IMEI.` |
| `NID-MS 123456789012` (12-digit invalid) | `"123456789012" has 12 digits which is not a valid NID length. NID must be exactly 10, 13, or 17 digits.` |

Multi-operator reply posting fix:

| Item | Status | Notes |
|------|--------|-------|
| New message per operator reply | Done | Each operator reply now posts as a **separate Telegram message** in the thread, instead of editing the previous message in-place. All messages remain visible in Telegram history. |
| Old edit-in-place behavior | Removed | `APPROVED_FOR_EDIT` status is no longer set. `postLiveEdits()` in bridge is now dead code. |

### Current caution

- The Android admin app UI still needs another fidelity pass to better match the Stitch references.
- `data/reply-patterns.json` changes on every test run (learned-keyword counts) — expect it to show as modified locally; don't read that as a real change.

### Important files for this session's changes

- `src/parser.js` — auto-correct logic (`tryAutoCorrectCommand()`), identifier sanitization, `diagnoseIdentifierError()`, strict `isNid()`/`isImei()` validators
- `src/service.js` — multi-operator reply posting change (new draft per reply instead of editing existing)
- `test/workflow.test.js` — 73 tests (was 52), all pass
- `test/persistence.test.js` — updated NID test values to valid 13-digit NIDs

### Current versions

| Surface | State | Notes |
|---------|-------|-------|
| Backend | Live on VPS after this session's deploy | Auto-correct, specific errors, multi-op reply fix all deployed |
| Android gateway app | Live | Unchanged in this session |
| Android admin app | Debug build active | Unchanged in this session |

### Test results

99 tests total, all passing:
- `test/workflow.test.js` — 73 tests (parser, auto-correct, specific errors, integration)
- `test/security.test.js` — 12 tests
- `test/persistence.test.js` — 5 tests
- `test/telegramBridge.test.js` — 9 tests

### Deployment / continuity notes

- Deploy via `bash scripts/deploy.sh` from Git Bash, or manually: `scp src/parser.js src/service.js root@45.77.240.195:/opt/sms-backend/src/ && ssh root@45.77.240.195 "pm2 restart sms-backend"`
- Config files are gitignored and per-machine (`config/auth.json`, `config/gateways.json`, `config/telegram.json`)

### Recommended next step

1. Resolve the two scope questions for unauthorized-sender rejection suppression (see `todo.md`).
2. Release gateway phone settings from PIN lock (Android-side change in `SettingsActivity.kt`).
3. Continue Android admin UI refinement against Stitch references.
4. Surface validation failures more prominently in web/admin audit views.

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
- Auto-correct common typos (split commands, glued prefixes, `+880` country code, separator stripping)
- Specific validation error messages (NID/IMEI/MSISDN cross-detection, digit counts, strict lengths)
- Strict NID (10/13/17) and IMEI (14/15) length validation
- Multi-operator replies post as separate Telegram messages (not edited in-place)
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

1. Resolve unauthorized-sender rejection suppression scope (see `todo.md`)
2. Release gateway phone settings from PIN lock (Android `SettingsActivity.kt`)
3. Increase Android admin app visual fidelity against the Stitch package
4. Surface backend validation failures more clearly in admin/web audit views
5. Resume V2 work on web admin and web operations surfaces
