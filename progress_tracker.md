# Progress Tracker

Last updated: **2026-06-14 (office PC — all three operators confirmed)**

---

## Current Stage

**ALL THREE OPERATORS WORKING END-TO-END. GP, Banglalink, Robi confirmed on VPS. System is fully operational.**

---

## Session Handoff (2026-06-13 evening) — Read This First

### What was accomplished this session

| Item | Status | Notes |
|------|--------|-------|
| Telegram offset persistence | Done | Bridge saves offset to `data/telegram-offset.json` — messages not lost on restart |
| Admin API key via /setup page | Done | Web form at `/setup` sets key in `config/auth.json` |
| Dual-SIM support | Done | One phone handles GP (SIM 2) + Banglalink (SIM 1) as two gateways |
| OTA update system | Done | Backend serves APK + version; phones update over internet; A55 publishes from Admin Panel |
| VPS deployment | Done | Vultr Singapore `45.77.240.195` — backend + bridge run permanently via PM2 |
| Telegram group ID fix | Done | Group upgraded to supergroup when bot became admin — ID changed to `-1004316326579` |
| Inbound SMS gateway routing fix | Done | SmsReceiver now reads SIM subId from intent to route GP replies to GP_PHONE_01 (not primary) |
| GP E2E test | **PASSED** | Full loop: Telegram → VPS → GP phone → operator SMS → reply → Telegram |
| Banglalink E2E test | **PASSED** | Same loop via SIM 1 on dual-SIM phone |

### Key bugs fixed this session

| Bug | Fix |
|-----|-----|
| Multiple bridge instances (409 Conflict) | Closed start-all.bat auto-restart loop; kill all node processes before starting |
| Bridge using old empty adminApiKey (silent 401) | Updated config/telegram.json with real key before restarting |
| Phone polling wrong IP (192.168.0.102 = itself) | Fixed backend_url in SharedPrefs via ADB sed |
| AP isolation on office WiFi (phone↔PC blocked) | Moved backend to VPS — phones connect over internet |
| node:sqlite missing on Node 20 | Upgraded VPS to Node.js 22 |
| GP reply posted as BANGLALINK_PHONE_01 gatewayId | SmsReceiver reads incomingSubId from intent, matches to configuredGateways() |

### Current app versions

| Version | Code | Notes |
|---------|------|-------|
| v2.0.2 | 18 | Current — battery optimization exemption (Samsung kill fix), published to VPS OTA |
| v2.0.1 | 17 | dual-SIM inbound routing fix |

---

## Environment (Current — VPS Production)

| Component | Location | Notes |
|-----------|----------|-------|
| Backend | `45.77.240.195:3000` | Vultr Singapore VPS, PM2 `sms-backend` |
| Telegram bridge | `45.77.240.195` | PM2 `sms-bridge` on same VPS |
| Gateway phone | Samsung (dual-SIM) | SIM 1 = Banglalink, SIM 2 = GP |
| Admin phone | Samsung A55 | Admin Panel, OTA publish |
| Robi phone | Not set up | Pending hardware |

### VPS credentials

See `config/vps.md` (gitignored).

---

## How to Start (VPS — always on, no action needed)

The backend and bridge run permanently on the VPS via PM2. To check status:

```bash
ssh root@45.77.240.195
pm2 status
pm2 logs sms-backend --lines 50
pm2 logs sms-bridge --lines 50
```

To restart after a code update:

```bash
ssh root@45.77.240.195
cd /opt/sms-backend
git pull
npm install
pm2 restart all
```

---

## How to Update the Android App

1. Make code changes on PC
2. Build: `scripts\publish-apk.ps1` (or run gradlew assembleRelease manually)
3. Publish to VPS: script uploads to `/api/app/publish-apk`
4. On each phone: **⋮ menu → Check for Update** (or it auto-checks on service start)
5. For USB-connected phones: `adb install -r app-release.apk`

---

## Known Issues / Gotchas

### 1. Telegram group chat ID changes when bot becomes admin
- Making bot admin upgrades group to supergroup — chat ID changes
- Update `groupChatId` in `config/telegram.json` on VPS and restart bridge
- Old ID: `-5291489718` → New ID: `-1004316326579`

### 2. Multiple bridge instances cause 409 Conflict
- `start-all.bat` has auto-restart loop — closing one bridge spawns another
- Always close the "Telegram Bridge" CMD window entirely, not just Ctrl+C
- Kill all: `Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -match 'telegram' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`

### 3. SmsReceiver dual-SIM routing
- Fixed in v2.0.1: reads `android.telephony.extra.SUBSCRIPTION_INDEX` from SMS intent
- Falls back to primary gateway if subId not available

### 4. Robi gateway
- Status: MOCK (no hardware yet)
- When Robi phone available: install app, set gateway ID = `ROBI_PHONE_01`, backend URL = VPS

### 5. SSH to VPS requires password
- Credentials in `config/vps.md` (gitignored)
- Consider adding SSH key for passwordless access

---

## Completed (Cumulative)

### Backend
- Request parsing, operator routing, per-operator queues
- Silent references, trusted-sender filter, reply matching
- Content-based reply disambiguation, payload-in-reply matching
- Non-blocking concurrent dispatch
- Training data (144 xlsx samples)
- Dashboard review actions (reject, retry, manual match)
- SQLite persistence (WAL, boot-restore)
- Admin API key, gateway secrets, audit chain
- OTA update endpoints (`/api/app/version`, `/api/app/apk`, `/api/app/publish-apk`)
- Admin panel endpoints, gateway health
- `/setup` web page for first-time admin key creation
- **VPS deployment — PM2, Node 22, UFW firewall**
- **Telegram offset persistence — no messages lost on restart**

### Telegram Bridge
- Long polling, intake loop, posting loop
- Threaded replies, text_mention tags
- autoApprove, timeout notifications
- Group-membership authorization
- **Offset saved to disk — resumes after downtime without losing messages**
- **Admin API key wired — bridge authenticates with backend**

### Android Gateway App
- NanoHTTPD, SMS send/receive, webhook, WorkManager retry, Room DB
- Foreground service, boot receiver, permissions flow
- SIM picker, dual-SIM support (two gateways on one phone)
- OTA update checker + installer (UpdateChecker, UpdateInstaller)
- Admin Panel (AdminActivity) — gateway health, publish APK
- Settings: secondary gateway, admin API key, SIM assignment
- Main toolbar: Admin Panel (admin only), Check for Update
- **v2.0.1: SmsReceiver routes inbound SMS to correct gateway via subId**
- **v2.0.2: Battery optimization exemption — prompts user to exempt app on first launch; Samsung won't kill service**
- **Backend URL fixed on all phones to VPS IP**

---

## Next Milestone

1. **Robi phone** — set up when hardware available (no code changes needed)
2. **SSH key auth on VPS** — avoid password every time
3. **Battery optimization exemption** on gateway phones (Samsung kills background services)
4. **Nightly DB backup** on VPS — cron job to copy `data/automation.db`

See `todo.md` for full task list.
