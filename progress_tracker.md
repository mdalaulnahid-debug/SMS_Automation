# Progress Tracker

Last updated: **2026-06-11 (office session)**

---

## Current Stage

**Full Telegram automation loop tested and working end-to-end on real devices.**

Officer sends a request in the Telegram group → bot acknowledges → gateway phone sends SMS to test number → reply received → bot posts reply back in-thread tagging the officer. Fully automated, no manual steps.

---

## Session Handoff (2026-06-11 office) — Read This First

### What was accomplished this session

| Item | Status | Notes |
|------|--------|-------|
| SQLite persistence (Phase 1) | Done | `src/persistence.js`, `node:sqlite`, WAL mode, boot-restore |
| Per-operator request_dispatches | Done | Fan-out status tracking, combined draft on finalize |
| Security layer (Phase 2) | Done | Admin API key, per-gateway secrets, deny-by-default users, hash-chained audit log |
| Telegram bridge | Done | Long polling, intake loop, posting loop, threaded replies, text_mention tags |
| Android Wave 1 | Done | `/send-sms` auth (gateway secret), portable signing (keystore.properties), Gradle wrapper |
| Android Wave 2 | Done | SIM picker via SubscriptionManager, createForSubscriptionId, READ_PHONE_STATE permission |
| PendingIntent callbacks wired | Done | Sent/delivered intents in SmsSender (Wave 3 foundation — receiver not yet built) |
| Dynamic backend connection | Done | LAN auto-discovery first, internet URL (ngrok/domain) as fallback |
| localtunnel support | Done | `node src/server.js --tunnel` prints public URL |
| autoApprove for Telegram | Done | Replies post to group instantly when `autoApprove: true` in telegram.json |
| start-all.bat | Done | Starts backend + bridge in separate windows, auto-restarts on crash, kills old server first |
| setup-telegram.bat | Done | Guided wizard: BotFather → group ID → officers → writes telegram.json |
| GitHub Actions CI fix | Done | `./gradlew` instead of bare `gradle` |
| **Full E2E Telegram test** | **PASSED** | See test record below |

### Successful Telegram E2E test record

| Field | Value |
|-------|-------|
| Request text | `LRL 01724761972` (sent in Telegram group) |
| Requester | Addl SP Barishal (Telegram ID `8914564310`) |
| Bot ack | ✅ "Request received — sending to GP" |
| Test destination | `01936759367` |
| Gateway phone | Samsung Galaxy A55 (`GP_PHONE_01`) at `192.168.0.167:8080` |
| Reply received from | `01936759367` |
| Bot posted reply | In-thread, tagging requester — fully automated |
| autoApprove | `true` — no manual dashboard step needed |

---

## Environment Snapshot (Office PC — 2026-06-11)

| Device | IP | Notes |
|--------|-----|-------|
| Office PC (backend) | `192.168.0.56` (Wi-Fi) | Also on Ethernet `192.168.1.4` and `10.157.90.217` |
| A55 gateway phone | `192.168.0.167` | Same Wi-Fi subnet as PC |
| Test reply phone | `01936759367` | Receives SMS, replies manually |
| Telegram bot | `@sms_automation_bd_bot` | Token in `config/telegram.json` (gitignored) |
| Telegram group | `Test group` | Chat ID `-5291489718` |

### Key config files (gitignored — must create manually on each machine)

| File | Status | Notes |
|------|--------|-------|
| `config/telegram.json` | Created | Bot token, group ID, authorized users, testDestination, autoApprove |
| `config/gateways.json` | Created | GP trustedSenders includes `01936759367` and `+8801936759367` |
| `config/auth.json` | Not created | Optional — blank adminApiKey = dev mode |
| `android-gateway/local.properties` | Created | Points to Android SDK |

---

## How to Start (any machine)

### Quick start (same network as phone)
```bat
git pull
start-all.bat        ← kills old server, starts backend + bridge, auto-restarts
```

### Internet access (phone on mobile data)
```bat
git pull
node src/server.js --tunnel    ← prints public URL
```
Paste the URL into Android app Settings → Backend URL.

### First time on a new machine
```bat
git pull
setup-telegram.bat   ← creates config/telegram.json interactively
start-all.bat
```

---

## Known Issues / Gotchas

### 1. Dual SIM on A55
- Slot 0 (GP): working. Slot 1: Emergency only.
- SIM picker now in app Settings → **SIM Card** section.
- Select the correct SIM before starting service.

### 2. SMS delivery callbacks (partial)
- `PendingIntent` sent/delivered are wired in `SmsSender.kt`.
- **BroadcastReceiver not built yet** — callbacks fire but nothing handles them.
- Backend still shows `SENT` before carrier confirms. Full fix is Wave 3.

### 3. Reply matching with multiple in-flight requests
- Current matching: silent reference (best) → time window fallback.
- If 2+ requests are pending for same operator simultaneously, time-window match returns `null`.
- **Fix planned:** content-based disambiguation using `replyAnalyzer.js` confidence scores.

### 4. ROBI and BANGLALINK gateways
- No physical phones assigned yet — status is `MOCK`.
- SMS is recorded in outbox only, no real send.
- Add `gatewayUrl` to `config/gateways.json` when phones are available.

### 5. testDestination in production
- `testDestination` in `config/telegram.json` overrides real operator shortcodes.
- **Remove it** (or set to `""`) when switching to production with real operator shortcodes.

---

## Completed (Cumulative)

### Backend
- Request parsing (LRL, LCL, MS-NID, NID-MS, IMEI-MS), operator routing, per-operator queues
- Silent references, trusted-sender filter, reply matching, time-window fallback
- HTTP phone gateway + mock mode, inbound webhook
- `testDestination` for pre-launch testing
- SQLite persistence (write-through, boot-restore, WAL mode)
- Per-operator `request_dispatches` table, derived request status
- Admin API key + per-gateway secrets + deny-by-default users
- Hash-chained tamper-evident audit log
- `start-all.bat`, `start-backend.bat`, `stop-backend.bat`, helper scripts
- 47/47 tests pass

### Telegram Bridge
- Long polling intake loop (drains backlog on restart)
- Deny-by-default authorized users (by Telegram user ID)
- In-thread ack on intake (names target operators)
- autoApprove: true → replies post instantly without dashboard approval
- Posting loop: threaded reply + text_mention entity tags requester
- Two-step posting: bridge confirms delivery before marking COMPLETED
- `config/telegram.json` with testDestination support
- `setup-telegram.bat` guided wizard
- `start-all.bat` with auto-restart and port cleanup

### Android Gateway App
- NanoHTTPD HTTP server, SMS send/receive, webhook, WorkManager retry, Room DB
- Foreground service (stable), boot receiver, permissions flow
- `/send-sms` auth — gateway secret required (blank = dev mode)
- SIM picker (SubscriptionManager, createForSubscriptionId)
- PendingIntent sent/delivered callbacks wired
- Dynamic backend connection: LAN scan first, internet URL fallback
- Portable signing: keystore.properties (gitignored), debug fallback
- Gradle wrapper (gradlew.bat + wrapper jar) — builds on any machine
- GitHub Actions CI fixed

---

## Next Milestone

1. **Wave 3 Android** — SMS delivery callbacks BroadcastReceiver, report SENT/FAILED/DELIVERED to backend
2. **Content-based reply matching** — use replyAnalyzer confidence to disambiguate multiple in-flight requests
3. **Training data pipeline** — save real operator replies to `data/reply-patterns.json` automatically
4. **Second gateway phone** (Robi/Banglalink) when hardware available
5. **Production config** — remove testDestination, add real operator shortcodes to trustedSenders

See `todo.md` for full task list.
