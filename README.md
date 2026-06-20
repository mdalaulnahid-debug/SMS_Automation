# SMS Automation

Lawful operator push-pull SMS automation bridge for Bangladesh mobile operators (GP, Robi, Banglalink). Authorized users submit formatted requests via Telegram; the backend routes them through Android gateway phones; operator replies are matched and the Telegram bridge posts the result back to the group.

This repo now has **three actively relevant application surfaces**:

| Part | Path | Role |
|------|------|------|
| **Backend** | `src/` | Node.js server: validate and canonicalize requests, queue per operator, call phone gateways, match replies, post replies via Telegram bridge |
| **Android Gateway App** | `android-gateway/app/` | Kotlin gateway runtime app on each operator phone: HTTP server for outbound SMS, SMS receiver for inbound, webhook forward to backend |
| **Android Admin App** | `android-gateway/adminapp/` | Separate Android supervisor console for overview, approvals, gateways, incidents, audit, and backend-admin connectivity |

## Work From Any PC

You can pull this repo on a home or office PC and continue work quickly, but there are two
different kinds of project state:

- **Tracked in Git:** source code, Android app, web UI, scripts, tests, docs
- **Not tracked in Git:** private config and secrets in `config/*.json`

### New PC checklist

1. Install **Node.js 18+**
2. Clone the repo
3. Run `npm install`
4. Restore these private files into `config/`
   - `auth.json`
   - `gateways.json`
   - `telegram.json`
5. Start the backend with `start-backend.bat`
6. If using Telegram intake/posting, start the bridge with `npm run start:telegram`

### If the private files are missing

Bootstrap from the examples:

```powershell
Copy-Item config\auth.example.json config\auth.json
Copy-Item config\gateways.example.json config\gateways.json
Copy-Item config\telegram.example.json config\telegram.json
```

Then replace the placeholder values with the real admin key, gateway secrets, and Telegram bot
settings.

### Important limits

- `data/automation.db` is local SQLite state, not auto-synced between PCs
- Android SDK, ADB, signing, and USB setup are still machine-specific
- pulling from Git is enough for **code and docs**, but not enough by itself for **production run**

**Continuing work?** Read `progress_tracker.md` first (session handoff, test results, known issues). Day-to-day tasks: `todo.md`.

Architecture direction for the next hardening phase lives in `docs/enterprise-architecture.md`.
The enterprise target blueprint is in `docs/system-design-v2.md`, and the new visual direction is
in `docs/ui-design-guide-v2.md`.

For the latest Android admin redesign and handoff context, read:

- `progress_tracker.md`
- `docs/CHANGELOG-2026-06-18.md`
- `docs/Design/android-admin-stitch/README.md`

---

## Quick Start (Testing)

### 1. Start the backend (PC)

Double-click or run from repo root:

```bat
start-backend.bat
```

This script:
- Checks Node.js is installed
- Detects PC **Wi‑Fi LAN IP** via `scripts/get-lan-ip.ps1` (skips NordVPN/Tailscale)
- Optionally adds Windows firewall rule for port 3000
- Runs `npm install` if needed
- Creates `config/gateways.json` from example if missing
- Stops any process already using port 3000
- Starts server on **`0.0.0.0:3000`**

Stop with:

```bat
stop-backend.bat
```

- Dashboard: `http://localhost:3000` or `http://<PC_LAN_IP>:3000`
- Phone app Backend URL: `http://<PC_LAN_IP>:3000` (or leave blank — app auto-discovers on same Wi‑Fi, v1.2.1+)

### 2. Configure gateways

Edit `config/gateways.json`:

```json
{
  "GP": {
    "gatewayUrl": "",
    "sendPath": "/send-sms",
    "apiKey": "",
    "trustedSenders": ["12345", "01712345678", "01936759367"]
  }
}
```

| Field | Meaning |
|-------|---------|
| `gatewayUrl` | **PC → phone** URL. Use `""` (empty) and the phone will auto-register via `POST /api/gateways/register` when Start Service runs. Or set manually: `http://<PHONE_IP>:8080` |
| `trustedSenders` | Operator shortcodes **and** every test reply phone number (normalized `01…` form) |

**Do not confuse two URLs:**

| Where | URL | Direction |
|-------|-----|-----------|
| Phone app Backend URL | `http://<PC_IP>:3000` | Phone → PC |
| `gateways.json` `gatewayUrl` | `http://<PHONE_IP>:8080` | PC → phone |

### 3. Install Android app

Latest release APK:

```
android-gateway/app/build/outputs/apk/release/app-release.apk
```

Current version: **1.2.1** (`versionCode` 8)

Build on Windows:

```bat
cd android-gateway
build-apk.bat
```

Requires JDK 17 and Android SDK API 34. See `android-gateway/README.md` for paths and troubleshooting.

### 3b. Build the separate Android admin app

```bat
cd android-gateway
gradlew.bat --offline :adminapp:assembleDebug
```

Debug APK output:

```text
android-gateway/adminapp/build/outputs/apk/debug/adminapp-debug.apk
```

Admin app notes:

- separate app from the gateway APK
- uses saved backend URL + admin API key
- reads live backend admin endpoints
- should preserve backend workflow authority

### 4. Phone app setup

1. Open app → grant **SMS** + **notification** permissions
2. **Settings**:
   - Gateway ID: `GP_PHONE_01` / `ROBI_PHONE_01` / `BANGLALINK_PHONE_01`
   - Backend URL: leave **blank** for auto-discovery, or `http://<PC_IP>:3000`
   - HTTP port: `8080`
   - Test Metadata: Telegram chat ID, requester name (for draft `@tag`)
3. **Dual-SIM phones:** set default **SMS SIM** in phone Settings → SIM manager to the working operator SIM (see `progress_tracker.md`)
4. **Start Service** → status **RUNNING**, backend **connected**
5. Use **Test Request** to send a test SMS to a target number

---

## End-to-End Flow

```text
Telegram group / dashboard / app test panel
  → POST /api/requests
  → backend validation + canonicalization
  → per-operator queue
  → gateway outbox job
  → phone sends SMS via SIM
  → operator (or test phone) replies via SMS
  → phone forwards POST /api/sms/inbound
  → trusted sender filter + request matching
  → reply analyzer → reply draft (NEEDS_MANUAL_REVIEW)
  → reviewer approves on dashboard → Telegram bridge posts reply to group
```

**Validated 2026-06-11:** full loop works with `testDestination` on Samsung A55 + home PC backend.

---

## Request Types

| Type | Payload | Routed to |
|------|---------|-----------|
| `LRL` | 1-5 MSISDNs (01xxxxxxxxx) | One operator only, derived from prefix (GP 013/017, Robi 016/018, BL 014/019) |
| `LCL` | 1-5 MSISDNs | Same operator constraint as LRL |
| `MS-NID` | 1-5 MSISDNs | Same operator constraint as LRL |
| `NID-MS` | 1-5 NIDs | All three operators |
| `IMEI-MS` | 1-5 IMEIs | All three operators |

Initially the system treated intake as a fully hardbound rule. That rule still applies to the operator-facing SMS, but intake is now lightly normalized first so harmless formatting mistakes do not break operation.

Allowed normalization examples:

- split compound commands such as `MS NID` -> `MS-NID`
- glued prefixes such as `LRL01712345678` -> `LRL 01712345678`
- lowercase or mixed-case command tokens
- `+880` / `880` country-code forms for MSISDN input
- safe separator stripping inside numeric identifiers

Outbound SMS body is always canonicalized to:

```text
COMMAND identifier1 identifier2 identifier3 identifier4 identifier5
```

Examples:

- `LCL    01710000000     01720000001` becomes `LCL 01710000000 01720000001`
- `lrl 01712345678` becomes `LRL 01712345678`
- `MS NID +8801712345678` becomes `MS-NID 01712345678`

The operator SMS itself is still hardbound. Normalization happens only at intake so the final dispatch remains the strict telecom format.

## Intake Validation Rules

- Supported commands only: `IMEI-MS`, `LCL`, `LRL`, `MS-NID`, `NID-MS`
- Command must be the first token
- Message may contain 1 to 5 identifiers
- Only one request type is allowed per message
- Repeating the command keyword inside the payload is rejected
- Identifiers must be digits only
- Harmless whitespace is normalized
- Invalid requests are rejected before queueing and are not sent to Android gateway phones
- Validation failures are preserved in audit with raw text and structured reason

---

## Test Mode (Current)

For pre-launch testing with a phone you control instead of operator shortcode `12345`:

1. App **Test Request** panel:
   - Request type + payload (e.g. `LRL 01724761972`)
   - **Target number** = phone that receives SMS and replies manually (e.g. `01936759367`)
2. Backend sends SMS to `testDestination` instead of operator shortcode
3. Add all reply numbers to `trustedSenders` in `config/gateways.json`
4. Reply manually from target phone; gateway forwards to backend
5. Dashboard shows draft — approve to post via Telegram bridge

### Telegram reply drafting

- Draft is stored on dashboard (reply drafts section).
- Draft starts with `@<Requester Name>` (plain text tag).
- Once a reviewer approves on the dashboard, the **Telegram bridge** (`telegram-bridge/`) posts the reply automatically to the Telegram group.
- Configure in app **Settings → Test Metadata**: Chat ID, Requester ID, Requester Name.

---

## Backend API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check; returns `preferredLanIp`, `backendUrls` (used by Android discovery) |
| GET | `/api/dashboard` | Full system snapshot |
| POST | `/api/gateways/register` | Phone registers `{ gatewayId, host, port }` → updates `gatewayUrl` in memory |
| POST | `/api/requests` | Submit request (`text`, `chatId`, `requesterId`, `requesterName`, optional `testDestination`) |
| POST | `/api/sms/inbound` | Inbound SMS webhook from phone |
| POST | `/api/reply-drafts/:id/approve` | Approve draft (manual → POSTED; automated channel → APPROVED_FOR_POST) |
| POST | `/api/reply-drafts/:id/posted` | Bridge confirms a draft was posted → completes request |
| GET | `/api/users` · POST | List / upsert authorized requesters (admin) |
| POST | `/api/users/:id/status` | Enable/disable a requester (admin) |
| GET | `/api/audit/verify` | Verify the audit hash chain (admin) |
| GET | `/api/audit/export` | Download the audit log as CSV (admin) |
| POST | `/api/timeouts/run` | Mark stale requests as timeout (also runs automatically every 60s) |

**Auth (Phase 2):** admin endpoints need `x-api-key` (or `Authorization: Bearer`) matching
`config/auth.json` → `adminApiKey`; `/api/sms/inbound` and `/api/gateways/register` need the
per-gateway `x-gateway-secret`. Empty `adminApiKey` = dev mode (auth off). Public: `/api/health`.

`POST /api/requests` now returns normalized validation failures with:

- `ok: false`
- `errorCode`
- `errors`
- `replyText`

Phone gateway contract: `docs/PHONE_GATEWAY_CONTRACT.md`

---

## Project Structure

```text
SMS_Automation/
├── start-backend.bat            # Backend launcher (Windows)
├── stop-backend.bat             # Stop process on port 3000
├── scripts/
│   ├── get-lan-ip.ps1           # Wi‑Fi IP detection (skips VPN)
│   ├── stop-backend-port.ps1    # Kill PID on port 3000
│   └── ensure-firewall-3000.ps1 # Optional firewall rule
├── src/                         # Node.js backend
│   ├── server.js                # HTTP server (HOST=0.0.0.0, PORT=3000)
│   ├── app.js                   # Routes
│   ├── service.js               # Business logic
│   ├── smsGateway.js            # Outbound HTTP to phones
│   ├── store.js                 # Data store (in-memory working set, SQLite write-through)
│   ├── persistence.js           # SQLite persistence (node:sqlite); load on boot, write-through
│   ├── network.js               # LAN IP helpers
│   ├── parser.js                # Request parsing
│   └── replyAnalyzer.js         # Reply matching
├── config/
│   └── gateways.example.json    # Phone URLs + trusted senders
├── public/                      # Dashboard UI
├── data/training-cache/         # Generated per-request-type cache from curated Excel workbooks
├── data/manual-review/          # Review-only rolling capture store (max 100 per request type)
├── data/training-summary.json   # Generated summary of imported training data
├── db/schema.sql                # Future SQLite schema (not wired)
├── android-gateway/             # Kotlin Android gateway app
│   ├── build-apk.bat            # Release APK build script
│   └── app/src/main/java/com/smsgateway/
│       ├── BackendDiscovery.kt  # Auto-find backend on LAN (v1.2.1)
│       ├── GatewayForegroundService.kt
│       ├── HttpServer.kt        # POST /send-sms
│       ├── SmsReceiver.kt       # Inbound SMS → webhook
│       ├── SmsSender.kt         # SmsManager wrapper
│       └── MainActivity.kt      # Status + test request UI
├── Training Data/               # Excel training examples
├── architecture.md
├── vision.md
├── progress_tracker.md          # Session handoff + status (read first)
├── todo.md                      # Task checklist
└── PROJECT_PLAN.md              # Phased roadmap
```

---

## Android Gateway App (Summary)

- **One APK** for all three phones; identity set per device in Settings
- Runs **NanoHTTPD** on port 8080 (`POST /send-sms`)
- **SmsReceiver** forwards inbound SMS to backend webhook
- **WorkManager** retries failed webhook deliveries
- **Room DB** logs sent/received messages
- **Foreground service** type: `dataSync` + `remoteMessaging` (Android 14+)
- **v1.2.1:** backend auto-discovery (priority scan, fast timeout), health validation
- **v1.1.4:** Start Service crash fixes (foreground promotion, notification)

### Known limitations (Android)

- `SmsSender` uses default SIM — **dual-SIM phones** must have correct default SMS SIM in phone settings, or SMS fails with "No service"
- App reports HTTP `ok: true` when SMS is **queued** to Android, not when carrier delivers — check Samsung Messages for real delivery status

---

## Training Data

Primary curated source of truth:

- `Training Data/Automation/LCL.xlsx`
- `Training Data/Automation/LRL.xlsx`
- `Training Data/Automation/MS-NID.xlsx`
- `Training Data/Automation/NID-MS.xlsx`
- `Training Data/Automation/IMEI-MS.xlsx`

Runtime matching reads generated caches, not the workbooks on every reply:

```bash
npm install
npm run import:training    # -> data/training-cache/*.json + data/training-summary.json
npm run organize:training  # -> Training Data/Organized/
```

Notes:

- the old single `data/reply-patterns.json` file is no longer used
- automatic self-training into the curated baseline is disabled
- review-only captures may be stored under `data/manual-review/`, capped at the latest 100 entries per request type

---

## Current Limitations

- **Persistent** via SQLite (`data/automation.db`, `node:sqlite`, WAL). Restart restores requests,
  drafts, audit log, queues, and registered gateway URLs; in-flight requests keep waiting. See
  `src/persistence.js` and `docs/telegram-bridge.md`.
- Reply analysis now combines payload anchoring, request-family checks, curated training-cache scoring, and manual-review fallback; it is safer than the earlier broad heuristic match, but it is still not a full structured extractor
- Intake and reply posting are via Telegram (see `docs/telegram-bridge.md`); dashboard is admin-only
- Backend API auth exists (Phase 2): admin API key + per-gateway secrets + deny-by-default users +
  hash-chained audit log. Set `config/auth.json`; empty key = dev mode. Phone-side rejection of
  unsigned `/send-sms` is still an Android TODO.
- Android inbound webhook retry now preserves original sender, full body, and receive time, and uses a deterministic delivery key so delayed resend after internet loss does not create duplicate reply processing
- Play Protect may warn on sideload — use signed release APK, tap Install anyway
- Office/home LAN IPs change — use auto-discovery or `start-backend.bat` printed IP

---

## Docs for AI Assistants

When continuing this project:

1. Read **`progress_tracker.md`** (latest session), then `architecture.md`, `vision.md`, `todo.md`
2. Review `docs/enterprise-architecture.md` for the target product structure
3. Backend contract: `docs/PHONE_GATEWAY_CONTRACT.md`
4. Restore gitignored config files if switching PCs: `config/auth.json`, `config/gateways.json`, `config/telegram.json`
5. Test flow: `testDestination` on `POST /api/requests` — see `src/smsGateway.js`, `src/service.js`
6. Phone matching: `normalizePhoneNumber()` in `src/domain.js`
7. Android gateway source: `android-gateway/app/src/main/java/com/smsgateway/`
8. Android admin source: `android-gateway/adminapp/src/main/java/com/smsgateway/admin/`
9. Stitch handoff package: `docs/Design/android-admin-stitch/`
10. Latest handoff log: `docs/CHANGELOG-2026-06-18.md`
11. Build gateway APK: `android-gateway/build-apk.bat` or `gradle assembleRelease`
12. Build admin APK: `cd android-gateway && gradlew.bat --offline :adminapp:assembleDebug`
13. Start backend: `start-backend.bat` from repo root or run `setup-workstation.bat` first on a fresh PC
14. Tests: `node --test`
15. Intake validation source of truth: `src/parser.js`

Safety principles (from `vision.md`): never alter operator SMS commands; only trust configured senders; manual review before posting reply; one active request per operator phone unless reference matching is reliable.
