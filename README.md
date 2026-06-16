# SMS Automation

Lawful operator push-pull SMS automation bridge for Bangladesh mobile operators (GP, Robi, Banglalink). Authorized users submit formatted requests via Telegram; the backend routes them through Android gateway phones; operator replies are matched and the Telegram bridge posts the result back to the group.

This repo has **two main parts**:

| Part | Path | Role |
|------|------|------|
| **Backend** | `src/` | Node.js server: parse requests, queue per operator, call phone gateways, match replies, post replies via Telegram bridge |
| **Android Gateway** | `android-gateway/` | Kotlin app on each operator phone: HTTP server for outbound SMS, SMS receiver for inbound, webhook forward to backend |

**Continuing work?** Read `progress_tracker.md` first (session handoff, test results, known issues). Day-to-day tasks: `todo.md`.

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
  → backend parser (LRL, LCL, MS-NID, NID-MS, IMEI-MS)
  → per-operator queue
  → POST http://PHONE_IP:8080/send-sms
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
| `LRL` | MSISDN (01xxxxxxxxx) | Operator matching prefix (GP 013/017, Robi 016/018, BL 014/019) |
| `LCL` | MSISDN | Same as LRL |
| `MS-NID` | MSISDN | GP + Robi + Banglalink |
| `NID-MS` | NID | All three |
| `IMEI-MS` | IMEI | All three |

Outbound SMS body is always exactly: `REQUEST_TYPE VALUE` (e.g. `LRL 01712345678`). No silent reference in the SMS.

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
| POST | `/api/requests` | Submit request (`text`, `whatsappGroupId`, `requesterWhatsappId`, `requesterName`, optional `testDestination`) |
| POST | `/api/sms/inbound` | Inbound SMS webhook from phone |
| POST | `/api/whatsapp-replies/:id/approve` | Approve draft (manual → POSTED; automated channel → APPROVED_FOR_POST) |
| POST | `/api/whatsapp-replies/:id/posted` | Bridge confirms a draft was posted → completes request |
| GET | `/api/users` · POST | List / upsert authorized requesters (admin) |
| POST | `/api/users/:id/status` | Enable/disable a requester (admin) |
| GET | `/api/audit/verify` | Verify the audit hash chain (admin) |
| GET | `/api/audit/export` | Download the audit log as CSV (admin) |
| POST | `/api/timeouts/run` | Mark stale requests as timeout (also runs automatically every 60s) |

**Auth (Phase 2):** admin endpoints need `x-api-key` (or `Authorization: Bearer`) matching
`config/auth.json` → `adminApiKey`; `/api/sms/inbound` and `/api/gateways/register` need the
per-gateway `x-gateway-secret`. Empty `adminApiKey` = dev mode (auth off). Public: `/api/health`.

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
├── data/reply-patterns.json     # Training-derived reply patterns
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

```bash
npm install
npm run import:training    # → data/reply-patterns.json
npm run organize:training  # → Training Data/Organized/
```

---

## Current Limitations

- ~~Backend storage is in-memory~~ **Persistent** via SQLite (`data/automation.db`, `node:sqlite`,
  WAL). Restart restores requests, drafts, audit log, queues, and registered gateway URLs;
  in-flight requests keep waiting. See `src/persistence.js` and `docs/telegram-bridge.md`.
- Reply analysis uses keyword/pattern matching, not structured field extractors yet
- Intake and reply posting are via Telegram (see `docs/telegram-bridge.md`); dashboard is admin-only
- Backend API auth exists (Phase 2): admin API key + per-gateway secrets + deny-by-default users +
  hash-chained audit log. Set `config/auth.json`; empty key = dev mode. Phone-side rejection of
  unsigned `/send-sms` is still an Android TODO.
- Play Protect may warn on sideload — use signed release APK, tap Install anyway
- Office/home LAN IPs change — use auto-discovery or `start-backend.bat` printed IP

---

## Docs for AI Assistants

When continuing this project:

1. Read **`progress_tracker.md`** (latest session), then `architecture.md`, `vision.md`, `todo.md`
2. Backend contract: `docs/PHONE_GATEWAY_CONTRACT.md`
3. Gateway config: `config/gateways.json` (gitignored; example in `config/gateways.example.json`)
4. Test flow: `testDestination` on `POST /api/requests` — see `src/smsGateway.js`, `src/service.js`
5. Phone matching: `normalizePhoneNumber()` in `src/domain.js`
6. Android source: `android-gateway/app/src/main/java/com/smsgateway/`
7. Build APK: `android-gateway/build-apk.bat` or `gradle assembleRelease`
8. Start backend: `start-backend.bat` from repo root
9. Tests: `node --test` (18 tests)

Safety principles (from `vision.md`): never alter operator SMS commands; only trust configured senders; manual review before posting reply; one active request per operator phone unless reference matching is reliable.
