# Progress Tracker

Last updated: **2026-06-11 (night session — home PC)**

---

## Current Stage

**Local MVP/prototype — first full end-to-end test PASSED on real devices.**

The SMS → reply → backend match → WhatsApp draft loop works in test mode (`testDestination`). WhatsApp posting is still manual (dashboard copy / approve only). Backend storage is in-memory (restart loses state).

---

## Session Handoff (2026-06-11) — Read This First Tomorrow

### What was accomplished tonight

| Item | Status | Notes |
|------|--------|-------|
| Backend running on home PC | Done | `start-backend.bat`, port 3000, binds `0.0.0.0` |
| Android app installed on A55 | Done | **v1.2.1** (`versionCode` 8) |
| Backend auto-discovery from phone | Done | Fixed in v1.2.1 — finds PC in ~0.2s on same subnet |
| Gateway phone registers with backend | Done | `POST /api/gateways/register` on Start Service |
| Start Service stable | Done | v1.1.4+ foreground service fixes |
| First E2E test (app → SMS → reply → draft) | **Done** | See test record below |
| Dual-SIM SMS failure diagnosed | Done | Wrong default SMS SIM; user fixed manually |
| `trustedSenders` includes test reply number | Done | `01936759367` in GP block |
| Backend unit tests | Done | **18/18 pass** (`node --test`) |

### Successful end-to-end test record

| Field | Value |
|-------|-------|
| Request ID | `REQ-20260610-0002-P94E` |
| Type / payload | `LRL 01724761972` |
| Test destination (SMS recipient) | `01936759367` |
| Gateway phone | Samsung Galaxy A55 (`GP_PHONE_01`) |
| Outbound SMS body | `LRL 01724761972` |
| Inbound reply from | `+8801936759367` |
| Final request status | `NEEDS_MANUAL_REVIEW` |
| WhatsApp draft | Created with `@Test User` tag |
| Reply analysis confidence | `LOW` (pattern matched location fields) |

Inbound reply body (real GP-style LRL response) included MSISDN, LACID, CellID, lat/long, address, CS/Volte status.

### Failed / timed-out test (earlier same night)

| Field | Value |
|-------|-------|
| Request ID | `REQ-20260610-0001-DAYR` |
| Reason | SMS never delivered — A55 default SMS SIM was **slot 1 (Emergency only)** |
| Backend showed | `SENT` (app queues to Android immediately; carrier failed later) |
| Final status | `TIMEOUT` |

**Lesson:** Backend `smsOutbox.sentStatus: SENT` means the phone HTTP gateway accepted the send, **not** that the carrier delivered the SMS.

---

## Environment Snapshot (Home PC — 2026-06-11)

> **Office PC tomorrow:** IPs and paths will differ. Do not assume these numbers. Use `start-backend.bat` printed IP and phone auto-discovery, or set Backend URL manually.

### Network (home Wi‑Fi)

| Device | IP | Notes |
|--------|-----|-------|
| Home PC (backend) | `192.168.0.230` | Wi‑Fi LAN; NordVPN adapter `10.5.0.2` — **ignore VPN IP for phone** |
| A55 gateway phone | `192.168.0.172` | Same Wi‑Fi as PC |
| Test reply phone | `01936759367` | Receives test SMS and sends manual reply |

### URLs (home session)

| Purpose | URL |
|---------|-----|
| Dashboard | `http://192.168.0.230:3000` |
| Health check | `http://192.168.0.230:3000/api/health` |
| Phone → backend (auto-discovered) | `http://192.168.0.230:3000` |
| Backend → phone gateway | `http://192.168.0.172:8080` (registered at runtime) |

### Two URLs (do not confuse)

| Config location | Example | Direction |
|-----------------|---------|-----------|
| Phone app **Backend URL** (or auto-discovery) | `http://<PC_IP>:3000` | Phone → PC |
| `config/gateways.json` **`gatewayUrl`** for GP | `""` (empty = auto-register) or `http://<PHONE_IP>:8080` | PC → phone |

When the phone **Start Service** runs, it calls `POST /api/gateways/register` and the backend updates `GP.gatewayUrl` in memory to `http://<phone_ip>:8080`.

### Hardware / software

| Item | Detail |
|------|--------|
| Gateway phone | Samsung Galaxy A55 (SM-A556E), Android 16 |
| Gateway SIM | Grameenphone (GP) — **dual SIM** (see known issue below) |
| Node.js backend | Port `3000`, `HOST=0.0.0.0` |
| Android app version | **1.2.1** (`versionCode` 8) |
| APK path | `android-gateway/app/build/outputs/apk/release/app-release.apk` |

### Build toolchain (home PC)

| Tool | Path |
|------|------|
| Gradle | `C:\BuildTools\gradle\gradle-8.6\bin\gradle.bat` |
| JDK (build) | `C:\Program Files\Android\Android Studio\jbr` |
| Android SDK (CLI build) | `C:\BuildTools\android-sdk` (API 34) |
| Android Studio SDK | API 36 only — CLI build needs BuildTools SDK |
| Keystore | `C:\BuildTools\smsgateway.keystore` |
| Build script | `android-gateway/build-apk.bat` |
| adb | `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe` |

### `config/gateways.json` (home — current)

```json
{
  "GP": {
    "gatewayUrl": "",
    "trustedSenders": ["12345", "01700000001", "01800000002", "01320151105", "01936759367"]
  }
}
```

- GP `gatewayUrl` empty → filled at runtime when phone registers.
- ROBI / BANGLALINK still have placeholder `192.168.1.10x` URLs from example (no physical phones yet).

### Phone app settings (test metadata — defaults)

| Setting | Value |
|---------|-------|
| Gateway ID | `GP_PHONE_01` |
| HTTP port | `8080` |
| Backend URL | blank (auto-discovery) or `http://<PC_IP>:3000` |
| WhatsApp Group ID | `test-whatsapp-group` (stored only; no auto-post) |
| Requester WhatsApp ID | `test-requester` |
| Requester Name | `Test User` (appears as `@Test User` in draft) |

---

## Known Issues / Gotchas

### 1. Dual SIM on A55 (critical)

Phone has **two Grameenphone SIMs**:

| Slot | subId | Status (during testing) |
|------|-------|-------------------------|
| SIM 1 (slot 0) | 2 | **Working** — normal GP signal |
| SIM 2 (slot 1) | 1 | **Emergency calls only** — no SMS |

`defaultSmsSubId` was **1** (broken SIM) → Android `resultCode: 4` (**No service**) → Samsung Messages shows **Message sent failed**.

**Fix applied by user:** Settings → SIM manager → set **SMS** to the working SIM (slot 0). Manual SMS then worked.

**App gap:** `SmsSender.kt` uses default `SmsManager` with no subscription picker. **TODO:** add SIM slot setting in app.

### 2. App reports SMS OK before carrier confirms

`HttpServer.kt` returns `{ ok: true }` immediately after `SmsManager.sendTextMessage()`. Carrier failure happens seconds later in Samsung Messages. Backend may show `SENT` while the SMS never left the network.

**TODO:** use `PendingIntent` sent callbacks and surface `FAILED` in logs + backend.

### 3. Backend in-memory store

Restart `start-backend.bat` → all requests, drafts, and registered gateway URLs are **lost**. Re-start phone service to re-register gateway.

### 4. No real WhatsApp integration

Draft appears on dashboard only. **Approve as Posted** updates backend status; you must **copy/paste** draft text into WhatsApp manually.

### 5. VPN on PC

NordVPN/Tailscale adapters must be skipped for LAN IP detection (`scripts/get-lan-ip.ps1` already prefers Wi‑Fi `192.168.*`).

### 6. Auto-discovery (fixed v1.2.1)

v1.2.0 scanned IPs 1→254 with 8s timeout and 10s total — never reached PC at `.230`. v1.2.1 scans high DHCP range first (200–254) with 1s connect timeout.

---

## Completed (Cumulative)

### Backend
- Node.js backend and static dashboard
- Strict parsing: `LRL`, `LCL`, `MS-NID`, `NID-MS`, `IMEI-MS`
- Operator routing, per-operator queues, silent references
- HTTP phone gateway + mock mode
- Inbound trusted-sender filter, reply matching, manual review flow
- `testDestination` for pre-launch testing
- `GET /api/health` with `preferredLanIp`, `backendUrls`
- `POST /api/gateways/register` — dynamic phone URL registration
- `src/network.js` — LAN IP detection (skips VPN)
- `start-backend.bat`, `stop-backend.bat`, helper PowerShell scripts
- Phase 0 code-review fixes (apiKey, timeout, queue dispatch, request ID suffix, etc.)
- Automatic timeout sweep every 60s

### Android gateway
- Kotlin app: NanoHTTPD, SMS send/receive, webhook, WorkManager retry, Room logs
- Foreground service (v1.1.4+ stable), boot receiver, permissions flow
- Settings, Test Request panel, backend health, copy IP
- **BackendDiscovery** auto-scan (v1.2.1)
- Signed release APK build (`build-apk.bat`)

### Training / docs
- Excel importer → `data/reply-patterns.json`
- Phone gateway contract: `docs/PHONE_GATEWAY_CONTRACT.md`

---

## Training Data Status

- Imported examples cover all five request types
- GP, Robi, Banglalink examples present
- Some rows have blank replies
- Keyword groups need cleanup; structured field extraction is the target
- Real GP LRL reply from tonight's test is a good extractor reference sample

---

## Verification Status

| Check | Result |
|-------|--------|
| `npm install` | Done on home PC |
| `node --test` | **18/18 pass** |
| `npm run import:training` | Generated `data/reply-patterns.json` |
| Backend health from phone | HTTP 200 |
| Gateway register | GP → `http://192.168.0.172:8080` |
| E2E test mode | **Passed** (REQ-20260610-0002-P94E) |
| APK build v1.2.1 | Success via `build-apk.bat` |

---

## Office PC — Quick Start Checklist (Tomorrow)

1. `git pull` (if repo synced) — bring latest code including v1.2.1 Android changes
2. Install **Node.js 18+** if missing
3. Run `start-backend.bat` from repo root — note the **printed LAN IP**
4. Open `http://localhost:3000` — dashboard should load
5. Phone on **same Wi‑Fi** as office PC (not mobile data)
6. Open SMS Gateway app on A55 — should show **Backend: connected** (or set Backend URL manually)
7. Confirm **Start Service** → RUNNING
8. Check `GET /api/dashboard` — GP `gatewayUrl` should show phone IP:8080
9. Confirm **default SMS SIM** is the working GP SIM (dual-SIM phones)
10. Run another Test Request if backend was restarted (in-memory state lost)

### If office network differs

- PC IP will change → auto-discovery should still work on same subnet
- If discovery fails: Settings → Backend URL → `http://<office_PC_IP>:3000`
- Add any new test reply numbers to `config/gateways.json` → `trustedSenders`
- Restart backend after editing `gateways.json`

### Useful debug commands

```bat
:: PC health
curl http://localhost:3000/api/health

:: Phone logs (USB connected)
%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe logcat -d -s BackendDiscovery,HttpServer,SmsSender,SmsReceiver,WebhookSender

:: Dashboard JSON
curl http://localhost:3000/api/dashboard
```

---

## Next Milestone

1. **SIM slot picker** in Android app + real SMS delivery callbacks
2. **SQLite persistence** (`db/schema.sql` → replace `AutomationStore`)
3. **Structured reply extractors** per operator × request type
4. **WhatsApp integration** evaluation (manual posting remains default until official API)
5. Second operator phone (Robi) when hardware available

See `todo.md` for full task list and `PROJECT_PLAN.md` for phased roadmap.
