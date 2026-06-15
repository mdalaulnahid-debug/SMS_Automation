# Progress Tracker

Last updated: **2026-06-15 — Multi-operator live posting implemented (v2.4.0)**

---

## Current Stage

**ALL THREE OPERATORS WORKING END-TO-END. GP, Banglalink, Robi confirmed on VPS. System is fully operational.**

Deploy is now one command from Git Bash: `bash scripts/deploy.sh` (passwordless via SSH key).

---

## Session Handoff (2026-06-15) — Read This First

### What was accomplished this session

| Item | Status | Notes |
|------|--------|-------|
| Android app v2.3.0 | Done | Real SIM phone number sent on registration; shown in admin gateway cards |
| SSH key auth on VPS | Done | `~/.ssh/id_ed25519` copied — `bash scripts/deploy.sh` runs without password |
| One-command deploy script | Done | `scripts/deploy.sh` — scp all src + bridge + config files, restart PM2 |
| MS-NID routing fix | Done | Was ALL_OPERATORS; now RELEVANT_OPERATOR (prefix-based: 017→GP, 018→Robi, etc.) |
| Telegram open-group auth | Done | `authorizedUsers: {}` — any group member can submit, not just whitelisted IDs |
| Late reply matching | Done | `findActiveRequestForGateway` now searches NEEDS_MANUAL_REVIEW requests (6h window) |
| Late reply re-posting | Done | If reply arrives after request finalized, existing draft updated and re-approved for post |
| Admin app UI redesign | Done | Stat hero row (ONLINE/OFFLINE/TOTAL), operator initial circles, dark theme |
| SIM switcher redesign | Done | Two-line stacked layout, cyan (SIM 1) / amethyst (SIM 2) color identity |
| Web dashboard dark theme | Done | Navy theme matching Android app |
| Robi phone updated | Done | v2.3.0 installed via ADB |
| **Multi-operator live posting** | **Done** | NID-MS / IMEI-MS post on first reply, edited as more come in |

### Key bugs fixed this session

| Bug | Fix |
|-----|-----|
| MS-NID sent to all 3 operators | Changed domain.js target to RELEVANT_OPERATOR |
| Telegram: non-whitelisted users rejected | Cleared authorizedUsers — group membership is the gate |
| VPS git pull blocked by no credentials | Deploy script uses scp directly — no git on VPS needed |
| Late operator replies dropped as unmatched | Extended search to NEEDS_MANUAL_REVIEW + re-approve draft |
| `config/telegram.json` broken by nano edit | Rewrote cleanly with `cat > file << EOF` |
| Fan-out results only posted when all done | Multi-op live posting — post immediately, edit as more reply |

### Current versions

| Version | Code | Notes |
|---------|------|-------|
| Backend v2.4.0 | — | Multi-operator live posting (NID-MS, IMEI-MS) |
| Android v2.3.0 | 41 | SIM phone number in registration + admin card |
| Android v2.2.7-beta | 40 | Previous |

---

## Environment (Current — VPS Production)

| Component | Location | Notes |
|-----------|----------|-------|
| Backend | `45.77.240.195:3000` | Vultr Singapore VPS, PM2 `sms-backend` |
| Telegram bridge | `45.77.240.195` | PM2 `sms-bridge` on same VPS |
| Gateway phone | Samsung (dual-SIM) | SIM 1 = Banglalink, SIM 2 = GP |
| Admin phone | Samsung A55 | Admin Panel, OTA publish |
| Robi phone | Samsung (f0c7c672) | v2.3.0 installed, Robi SIM confirmed |

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

---

## Next Milestone

1. **Deploy to VPS** — run `bash scripts/deploy.sh` to push multi-operator live posting
2. **Nightly DB backup on VPS** — cron job
3. **compileSdk/targetSdk bump** to 35
