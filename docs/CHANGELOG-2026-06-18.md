# Change Log - 2026-06-18

This file is the handoff log for another PC, another developer, or another coding agent.

## What Changed

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

## Locked Product Decisions

- Backend remains the single workflow authority
- Web operations UI, web admin console, Android gateway app, and separate Android admin app remain separate surfaces
- Android admin app must stay separate from the Android gateway app
- Admin capability remains available from both web admin and Android admin
- Telegram remains the preferred automation surface
- UI should keep moving away from amateur boxy dashboards toward a professional command-center feel

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

- Backend workflow logic was not redesigned in this pass
- Android gateway app behavior was not reworked in this pass
- Web surfaces were not finalized in this pass

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

1. Continue improving Android admin screen fidelity against the Stitch references
2. Make the bottom nav less blocky by moving from filled tabs toward a slimmer active-state marker
3. Refine approvals, gateways, incidents, and audit rows so they feel more custom and less text-heavy
4. Continue V2 redesign on web admin and web operations surfaces
5. Keep docs synchronized after each visible UI pass

## Safe Starting Point For Another Agent

1. Read `progress_tracker.md`
2. Read this file
3. Read `docs/system-design-v2.md` and `docs/ui-design-guide-v2.md`
4. Review `docs/Design/android-admin-stitch/README.md` and `DESIGN.md`
5. Inspect `android-gateway/adminapp/`
6. Build the admin app before making UI changes
7. Avoid changing backend workflow logic unless explicitly requested
