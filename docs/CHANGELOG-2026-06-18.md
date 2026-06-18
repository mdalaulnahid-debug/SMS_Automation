# Change Log - 2026-06-18

This file is the handoff log for another PC, another developer, or another coding agent.

## What Changed

- Implemented multi-number batching (1-5 identifiers per request) in `src/parser.js`, `src/service.js`, and `src/domain.js`, matching the official push-pull service rule sheet
- Added canonical request normalization and 11 structured `errorCode`s before queueing or dispatch
- Added structured validation failure audit events (`REQUEST_VALIDATION_FAILED`)
- Fixed batch-reply collection so an operator replying once per number (not one combined SMS) is fully captured (`c26b896`)
- Added duplicate-active-request blocking (30 min window)
- Anchored the reply-window timeout clock on carrier-confirmed send time (`sendResult.confirmedAt`) instead of queue time, plus a separate send-confirmation grace period for claimed-but-unacked jobs
- Added a dedicated `POST /api/gateway/heartbeat` endpoint so gateway `lastSeenAt` stays fresh even with zero pending jobs; wired into the Android poll loop every 30s
- Fixed the poll-thread watchdog restart in `GatewayForegroundService.kt`
- Added new admin diagnostics (`delayedConfirmations`, `ambiguousReplies24h`, `duplicateRiskGroups`) to `/api/dashboard` and the web admin console
- Added parser and integration regression tests for valid/invalid official request formats (71 tests total, all passing)
- Reconciled `docs/multi-number-batching-plan.md` (was a pre-implementation plan) and `docs/PHONE_GATEWAY_CONTRACT.md` (was describing a dead push-send model) against the actual shipped code
- Added and iterated the separate Android admin app under `android-gateway/adminapp/`
- Connected the Android admin app to the live backend using saved backend URL + admin API key
- Updated the Android admin app shell toward the V2 command-center direction
- Restored a dedicated native Settings surface in the admin app
- Reworked the Overview screen around posture, KPI signal, fleet snapshot, and escalations
- Added reusable admin app visual primitives, theme tokens, and command-center drawables
- Added custom bottom navigation icons with compact tags
- Preserved backend workflow logic and live API integration
- Preserved the separation between the Android gateway app and the Android admin app
- Organized the Stitch design handoff package under `docs/Design/android-admin-stitch/`

## Key Commits

- `a34c82b` - Implement V2 admin surfaces and Android admin app
- `ad76496` - Refine Android admin app command-center UI
- `c1582c5` - Document multi-number batching plan and fix stale MS-NID routing in README (pre-implementation)
- `8bd26a5` - Harden backend intake validation and surface audit failures (the batching implementation)
- `cbb2d4f` - Align gateway live status with backend heartbeat
- `a76d988` - Harden request lifecycle timeouts and admin diagnostics
- `b3bc890` - Fix gateway poll watchdog restart
- `c26b896` - multiple number bug fixed (batch-reply collection)

Git `main` and the production VPS are both confirmed live at `c26b896` (verified directly against `https://licbarishal.duckdns.org`, not assumed).

## Locked Product Decisions

- Backend remains the single workflow authority
- Backend validates request format before queueing or dispatching
- Invalid requests must never be sent to Android gateway phones
- Multi-number batching (1-5 identifiers) follows the official push-pull service rule sheet; mixed operators in one `LCL`/`LRL`/`MS-NID` batch are rejected, not split
- Type-token formatting mistakes (`MS NID`, `LRL01308-218563`) are rejected with a specific error, not auto-corrected — this reverses an earlier same-day decision to auto-correct trivial cases; revisit if that's still wanted
- Web operations UI, web admin console, Android gateway app, and separate Android admin app remain separate surfaces
- Android admin app must stay separate from the Android gateway app
- Admin capability remains available from both web admin and Android admin
- Telegram remains the preferred automation surface
- UI should keep moving away from amateur boxy dashboards toward a professional command-center feel

## Current Backend Intake State

Behavior now:

- Supported commands: `IMEI-MS`, `LCL`, `LRL`, `MS-NID`, `NID-MS`, each accepting 1-5 identifiers
- Harmless whitespace is normalized
- Canonical dispatch text is generated before gateway outbox creation
- `LCL`, `LRL`, and `MS-NID` reject mixed-operator batches (`OPERATOR_MISMATCH`)
- `NID-MS` and `IMEI-MS` continue to fan out to all operators
- Invalid requests return one of 11 normalized `errorCode`s, `errors`, and `replyText` — full list in `docs/multi-number-batching-plan.md`
- Invalid requests do not create normal request rows and do not enter queue/outbox
- Validation failures are still visible through the audit path (`REQUEST_VALIDATION_FAILED`)
- Identical active requests (same type/payload/operators) within 30 minutes are blocked (`DUPLICATE_ACTIVE_REQUEST`)
- The operator reply-window clock starts from carrier-confirmed send time, not queue time, with a separate grace period for the claim-to-ack gap
- Gateway phones heartbeat the backend every 30s independent of job polling, so `lastSeenAt` doesn't go stale on a quiet operator

## Current Android Admin App State

Code root:

- `android-gateway/adminapp/src/main/java/com/smsgateway/admin/`

Key files:

- `AdminMainActivity.java`
- `AdminBackendClient.java`
- `AdminDesignSystem.java`
- `res/layout/activity_admin_main.xml`
- `res/layout/include_admin_overview.xml`
- `res/layout/include_admin_settings.xml`
- `res/layout/include_admin_approvals.xml`
- `res/layout/include_admin_gateways.xml`
- `res/layout/include_admin_incidents.xml`
- `res/layout/include_admin_audit.xml`
- `res/values/colors.xml`
- `res/values/dimens.xml`
- `res/drawable/admin_*`
- `res/drawable/ic_admin_nav_*`

Behavior now:

- Separate Android app for mobile supervision
- Live connection to backend using saved URL and admin API key
- Overview, Approvals, Gateways, Incidents, Audit, and Settings surfaces
- Header-level Settings access
- Bottom nav uses icons plus short tags
- Build/install path verified on Samsung A55 over USB

## What Was Not Changed

- Android gateway app behavior was not reworked in this pass
- Web surfaces were not finalized in this pass
- Android admin UI was not further redesigned during the backend validation slice

## Build / Run Notes

Admin app build:

```bat
cd android-gateway
gradlew.bat --offline :adminapp:assembleDebug
```

Install to device:

```bat
adb install -r android-gateway\adminapp\build\outputs\apk\debug\adminapp-debug.apk
```

Backend verification:

```bash
curl -i -H "x-api-key: @Alpha4$88_poL#" https://licbarishal.duckdns.org/api/admin/overview
```

## VPS Update Notes

The repo is pushed to GitHub through `ad76496`, but the final VPS update was not completed directly from this workstation because SSH password auth failed here.

Safe server update commands:

```bash
cd /opt/sms-backend
git status --short
git fetch origin main
git pull origin main
npm install
pm2 restart all
curl -i -H 'x-api-key: @Alpha4$88_poL#' https://licbarishal.duckdns.org/api/admin/overview
```

If `git pull` is blocked by local changes on the VPS:

```bash
cd /opt/sms-backend
git stash push -u -m "pre-ad76496-sync"
git pull origin main
npm install
pm2 restart all
```

## Design Handoff

The Stitch-inspired Android admin design package is stored at:

- `docs/Design/android-admin-stitch/`

Files there include:

- screenshots for overview, approvals, gateways, incidents, audit, and system
- `DESIGN.md`
- raw exported HTML in `stitch-export/`

Important note:

- On this Windows workstation, the folder is also reachable through `docs/design/android-admin-stitch/`, but Git currently recognizes and stages it under `docs/Design/android-admin-stitch/`

## Known Gaps / Next Best Work

1. Decide whether to add the type-token auto-correct layer that was planned but not shipped, or close it out as won't-do
2. Surface validation failure events and the new diagnostics counters more clearly in the web/admin audit experience
3. Continue improving Android admin screen fidelity against the Stitch references
4. Make the bottom nav less blocky by moving from filled tabs toward a slimmer active-state marker
5. Refine approvals, gateways, incidents, and audit rows so they feel more custom and less text-heavy
6. Continue V2 redesign on web admin and web operations surfaces
7. Keep docs synchronized after each visible UI pass — this file and `progress_tracker.md` had drifted behind several commits before this reconciliation pass; don't let that happen again

## Safe Starting Point For Another Agent

1. Read `progress_tracker.md`
2. Read this file
3. Read `docs/multi-number-batching-plan.md` and `docs/PHONE_GATEWAY_CONTRACT.md` for the current backend intake/dispatch contract
4. Read `docs/system-design-v2.md` and `docs/ui-design-guide-v2.md`
5. Review `docs/Design/android-admin-stitch/README.md` and `DESIGN.md`
6. Inspect `android-gateway/adminapp/`
7. Inspect `src/parser.js`, `src/service.js`, and `test/workflow.test.js` for the intake contract
8. Build the admin app before making UI changes
9. Avoid changing Android gateway runtime unless explicitly requested
