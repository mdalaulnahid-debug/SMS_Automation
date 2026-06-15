# Progress Tracker

Last updated: **2026-06-15 — Admin monitoring dashboard + dual-SIM A16 fix (v2.6.1)**

---

## Current Stage

**ALL THREE OPERATORS WORKING END-TO-END. GP, Banglalink, Robi confirmed on VPS. System is fully operational.**

Deploy is now one command from Git Bash: `bash scripts/deploy.sh` (passwordless via SSH key).

---

## Session Handoff (2026-06-15) — Read This First

### What was accomplished this session

| Item | Status | Notes |
|------|--------|-------|
| Settings split | Done | Theme/display/about/help freely accessible; admin config (URL, gateway ID, API key) behind PIN in "Gateway & Connection" submenu |
| About section | Done | Collapsible card with chevron; shows version inline in header |
| Help section | Done | Collapsible; stripped of all backend/admin info — only shows "contact your administrator" |
| Admin phone monitoring (A55) | Done | AdminActivity rebuilt as 5-tab dashboard: OVERVIEW, GATEWAYS, REQUESTS, AUDIT, PUBLISH |
| Auto-refresh | Done | Dashboard auto-refreshes every 30s using `repeatOnLifecycle` + coroutine loop |
| Request status colour coding | Done | WAITING=blue, QUEUED/RETRY=yellow, COMPLETED=green, FAILED/TIMED_OUT=red |
| Audit log actor badges | Done | ADMIN=cyan, SYSTEM=yellow, others=grey |
| Backend health dot | Done | Green/red dot on OVERVIEW tab with live URL display |
| OTA deploy fix | Done | `scripts/deploy.sh` was missing `app-version.json` copy — now included |
| **A16 dual-SIM label fix** | **Done** | Samsung A16 returned "GP" for both SIM slots; labels now come from gateway ID only; "SIM 2" fallback when unconfigured |
| **A16 dual-SIM visibility fix** | **Done** | `isDualSimHardware()` now checks `TelephonyManager.phoneCount` first (no permission needed) — switcher no longer hides on A16 |

### Key bugs fixed this session

| Bug | Fix |
|-----|-----|
| All settings hidden behind PIN | Split: display/help/about free; only admin config gated |
| Samsung A16: both SIM labels show "GP" | Labels derived from gateway ID only, not `SubscriptionInfo.displayName` |
| Samsung A16: Banglalink SIM option gone | `isDualSimHardware()` now checks modem count before permission-gated APIs |
| `scripts/deploy.sh` missing version JSON | Added `scp public/app-version.json` to deploy script |
| A16 secondary gateway ID never set by QR | QR only sets primary — must configure secondary via Admin Setup manually |

### Current versions

| Version | Code | Notes |
|---------|------|-------|
| Backend v2.4.0 | — | Multi-operator live posting (NID-MS, IMEI-MS) |
| Android v2.6.1 | 47 | A16 dual-SIM label + visibility fix |
| Android v2.6.0 | 46 | 5-tab admin monitoring dashboard |
| Android v2.3.0 | 41 | Previous stable (SIM phone number) |

### Pending on A16 gateway phone (action required)

After installing v2.6.1, the A16 user must configure the secondary gateway manually:
1. Open app → Settings → **Gateway & Connection** → enter PIN
2. Set **Secondary Gateway ID** = `BANGLALINK_PHONE_01`
3. Set **Secondary SIM** = SIM 2
4. Tap **Save**

Until this is done, SIM 2 shows as "SIM 2" (unconfigured) and dispatches won't route to Banglalink.

---

## Environment (Current — VPS Production)

| Component | Location | Notes |
|-----------|----------|-------|
| Backend | `45.77.240.195:3000` | Vultr Singapore VPS, PM2 `sms-backend` |
| Telegram bridge | `45.77.240.195` | PM2 `sms-bridge` on same VPS |
| A16 gateway phone | Samsung A16 (`R9TY808NKZL`) | SIM 1 = GP, SIM 2 = Banglalink; v2.6.1 |
| Admin phone | Samsung A55 (`RRCXA03MTRA`) | 5-tab monitoring dashboard; v2.6.0+ |
| Robi phone | Samsung (`f0c7c672`) | v2.3.0 installed, Robi SIM confirmed |

### VPS credentials

See `config/vps.md` (gitignored).

---

## How to Deploy (One Command)

```bash
bash scripts/deploy.sh
```

Copies `src/`, `telegram-bridge/`, and `config/telegram.json` directly via SCP, then restarts PM2. No git credentials needed on the VPS.

---

## How to Update the Android App

1. Make code changes on PC
2. Build release APK: `cd android-gateway && .\gradlew assembleRelease`
3. Install via USB: `adb -s <device-id> install -r app/build/outputs/apk/release/app-release.apk`
4. Or publish OTA via Admin Panel on A55 → gateway phones auto-update

---

## Known Issues / Gotchas

### 1. Telegram group chat ID changes when bot becomes admin
- Making bot admin upgrades group to supergroup — chat ID changes
- Update `groupChatId` in `config/telegram.json` and run `bash scripts/deploy.sh`

### 2. SIM phone number often blank in Bangladesh
- Carriers don't provision phone number into SIM chip — `SubscriptionInfo.number` returns empty
- Admin card shows number when available; hidden when blank (no UI breakage)

### 3. MS-NID for unknown prefix (e.g. Teletalk 010x)
- `operatorForMsisdn` returns null — request fails validation with a clear error message
- Teletalk not in domain.js OPERATORS — add when needed

### 4. VPS deploy: config/telegram.json is gitignored
- `scripts/deploy.sh` handles this by SCP-copying it directly
- Do NOT edit telegram.json on VPS manually unless necessary — deploy script will overwrite it

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
- OTA update endpoints
- `/setup` web page for first-time admin key creation
- VPS deployment — PM2, Node 22, UFW firewall
- Telegram offset persistence
- **MS-NID: routes to single operator by MSISDN prefix**
- **Late reply matching: 6-hour window for NEEDS_MANUAL_REVIEW requests**
- **Late reply re-posting: updates existing draft instead of dropping reply**
- **Gateway registration stores SIM phone number**

### Telegram Bridge
- Long polling, intake loop, posting loop
- Threaded replies, text_mention tags
- autoApprove, timeout notifications
- **Open-group auth: any group member can submit**

### Android Gateway App
- NanoHTTPD, SMS send/receive, webhook, WorkManager retry, Room DB
- Foreground service, boot receiver, permissions flow
- SIM picker, dual-SIM support
- OTA update checker + installer
- Admin Panel (AdminActivity) — gateway health, publish APK
- Settings: secondary gateway, admin API key, SIM assignment
- **v2.3.0: SIM phone number read and sent to backend; shown in admin card**
- **Admin app dark theme redesign: stat hero row, operator circles**
- **SIM switcher: two-line stacked, cyan/amethyst color identity**
- **Web dashboard: dark navy theme**
- **v2.6.0: Settings split (theme/help/about free; admin config PIN-gated); 5-tab admin monitoring dashboard with auto-refresh**
- **v2.6.1: A16 dual-SIM label fix (Samsung returns "GP" for both slots); modem-count-first dual-SIM detection**

---

## Next Milestone

1. **[TOMORROW] Release gateway phone settings from PIN lock** — Backend URL, Gateway ID, SIM slot should be editable without PIN; only admin key, secondary gateway config, and PIN management stay gated
2. **Configure A16 secondary gateway** — set `BANGLALINK_PHONE_01` / SIM 2 via Admin Setup on A16
3. **Nightly DB backup on VPS** — cron job
4. **compileSdk/targetSdk bump** to 35
