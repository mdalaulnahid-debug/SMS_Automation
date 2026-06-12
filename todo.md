# Todo

Start with `progress_tracker.md` for the latest session handoff, test results, and environment details.

---

## Home PC — New Machine Setup (READ THIS FIRST)

> The system is fully working end-to-end (E2E passed 2026-06-11).
> Two config files are gitignored and must be created manually on every new machine.
> Everything else is automated.

### Step 1 — Pull latest code
```bat
git pull
npm install
```

### Step 2 — Create the two gitignored config files

```bat
copy config\telegram.example.json config\telegram.json
copy config\gateways.example.json config\gateways.json
```

Then edit `config\telegram.json` and fill in:
- `"botToken"` — from BotFather (the real token is in the office PC's `config/telegram.json`)
- `"groupChatId"` — `-5291489718` (Test group)
- `"testDestination"` — `"01936759367"` (test reply phone)
- `"autoApprove"` — `true`
- `"authorizedUsers"` — `"8914564310"` for Addl SP Barishal

Then edit `config\gateways.json` and make sure `trustedSenders` for GP includes:
- `"01936759367"` and `"+8801936759367"`

> Tip: if you have access to the office PC, just copy those two files directly via USB or cloud.

### Step 3 — Start everything
```bat
start-all.bat
```
This kills any old server on port 3000, starts backend + Telegram bridge in separate windows with auto-restart.

### Step 4 — Connect Android app
- Open Samsung Galaxy A55 → SMS Gateway app
- Settings → Backend URL: `http://<HOME_PC_IP>:3000`
  - Find home PC IP: run `ipconfig` and look for Wi-Fi IPv4 (e.g. `192.168.x.x`)
  - Or the app will auto-discover it on the same Wi-Fi subnet
- Select SIM: Slot 0 (GP)
- Tap **Start Service** → status should show "Backend: connected"

### Step 5 — Test the full loop
```
Send in Telegram group:  LRL 01724761972
```
Expected:
1. Bot replies in-thread: "✅ Request received — sending to GP..."
2. SMS arrives at `01936759367`
3. Reply from `01936759367`
4. Bot posts reply in-thread, tags officer

### If phone and PC are on different networks (mobile data)
```bat
node src/server.js --tunnel
```
Copy the printed public URL → paste into Android app Settings → Backend URL.

---

## Home PC — Status (2026-06-12)

- [x] `git pull` + `npm install`
- [x] Create `config/telegram.json` — done (botToken, groupChatId, autoApprove, authorizedUsers empty)
- [x] Create `config/gateways.json` — done (GP gatewayUrl `http://192.168.0.172:8080`)
- [x] Run `start-all.bat` — tested, loop working
- [x] Android app installed via `adb install` — new UI with hero status, stats, collapsible details
- [x] Full loop tested: Telegram → backend → SMS → reply → Telegram
- [ ] Re-enter Android app settings after reinstall (Gateway ID, Backend URL, SIM)

---

## Android Gateway App — Wave 3 (Next Priority)

- [ ] **SMS delivery BroadcastReceiver** — handle `ACTION_SMS_SENT` and `ACTION_SMS_DELIVERED` intents from `SmsSender.kt`
  - Update `LogEntry` status in Room DB (OK → SENT → DELIVERED or FAILED)
  - POST delivery status to backend via new `/api/sms/delivery` endpoint or outbox update
- [ ] **Surface delivery failure** on main screen — show FAILED toast/banner when carrier rejects
- [ ] **Add `subId` field to `LogEntry`** — track which SIM sent each message (bump Room DB version)

## Android Gateway App — Wave 4

- [ ] **Idempotency key** on inbound webhook — stable message ID = SIM slot + timestamp + sender hash; backend deduplicates
- [ ] **Battery optimization exemption** — prompt `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` on first launch (Samsung kills background services)
- [ ] **EncryptedSharedPreferences** for API key storage
- [ ] **Phone health endpoint** — `GET /health` on the phone for backend dashboard online/offline indicator
- [ ] **compileSdk/targetSdk bump** to 35

---

## Backend — Reply Matching

- [x] **Training data import** — 144 xlsx samples imported to `data/reply-patterns.json` (LRL:42, LCL:62, MS-NID:22, IMEI-MS:11, NID-MS:7)
- [x] **Payload-in-reply matching** — `payloadInReply()` finds phone/NID/IMEI in operator reply body
- [ ] **Auto-save training data** — when a reply is matched, save its keywords to `data/reply-patterns.json` automatically
- [ ] **Request type detection from reply** — detect reply type from content and match to pending requests of that type

---

## Backend — General

### High Priority
- [ ] **Retry failed gateway sends** — exponential backoff when phone HTTP returns error
- [ ] **Gateway health dashboard** — show online/offline, last-seen, stale queue alert

### Medium Priority
- [ ] **Phone health checks** — dashboard shows gateway online/offline + last registered time
- [ ] **Audit export** — CSV download of full audit log for evidence purposes
- [ ] **Alerting** for stuck queues and timeout spikes
- [ ] **Windows service** — run backend as NSSM service so it survives PC reboots

---

## Telegram Bridge

- [ ] **Operator-specific routing** — allow officer to specify operator in message (e.g. `LRL 017xxx GP`) to target a single operator instead of all
- [ ] **Error notification** — if backend is unreachable, bot posts an error in-thread

---

## Production Readiness

- [ ] **Remove `testDestination`** from `config/telegram.json` when switching to real operator shortcodes
- [ ] **Add real operator shortcodes** to `trustedSenders` in `config/gateways.json` for each operator (GP, Robi, Banglalink)
- [ ] **Second gateway phone** (Robi SIM) — add `gatewayUrl` to `config/gateways.json`
- [ ] **Third gateway phone** (Banglalink SIM) — same
- [ ] **Auth hardening** — set real `adminApiKey` in `config/auth.json`, set gateway secrets in app + gateways.json
- [ ] **Nightly DB backup** — copy `data/automation.db` to backup location
- [ ] **Log rotation** — cap Room DB log size on Android

---

## Training Data

- [x] Add real operator replies as training samples in `Training Data/` Excel files (144 rows imported)
- [x] Run `npm run import:training` — generates `data/reply-patterns.json`
- [ ] Add real GP LRL reply from the E2E test as reference sample
- [ ] Add Robi and Banglalink reply samples when available

---

## Test Checklist (re-run at home)

1. [ ] `git pull` — get latest
2. [ ] `config/gateways.json` — trustedSenders includes `01936759367`
3. [ ] `config/telegram.json` — testDestination `01936759367`, autoApprove `true`
4. [ ] `start-all.bat` — backend + bridge both running
5. [ ] Android app: SIM picker → select GP SIM, start service → RUNNING
6. [ ] Send in Telegram group: `LRL 01724761972`
7. [ ] Bot acks in-thread
8. [ ] SMS arrives at `01936759367`
9. [ ] Reply from `01936759367`
10. [ ] Bot posts reply in Telegram thread, tags officer

---

## Completed (archive)

- [x] Phase 0 code-review fixes (apiKey, timeout, queue, request ID, sender matching)
- [x] First E2E test (REQ-20260610-0002-P94E) — SMS loop working
- [x] SQLite persistence — write-through, boot-restore, WAL
- [x] Per-operator request_dispatches — fan-out status, combined draft
- [x] Security — admin API key, gateway secrets, deny-by-default, audit chain
- [x] Telegram bridge — intake loop, posting loop, threaded replies, text_mention
- [x] autoApprove — Telegram replies skip manual review
- [x] start-all.bat + setup-telegram.bat
- [x] Android Wave 1 — /send-sms auth, portable signing, Gradle wrapper
- [x] Android Wave 2 — SIM picker, READ_PHONE_STATE
- [x] PendingIntent callbacks wired in SmsSender
- [x] Dynamic backend connection — LAN scan first, internet URL fallback
- [x] localtunnel support (`--tunnel` flag)
- [x] GitHub Actions CI fixed
- [x] Full Telegram E2E test PASSED (2026-06-11)
- [x] 47/47 backend tests pass
- [x] Content-based reply disambiguation (ambiguous matches scored by `analyzeOperatorReply`)
- [x] Dashboard review actions — reject, retry, manual match (4 new API endpoints)
- [x] Dashboard UI overhaul — status colors, action buttons, unmatched SMS section, 10s auto-refresh
- [x] Telegram timeout/failure notifications (in-thread with requester mention)
- [x] Removed "Review confidence" line from combined draft
- [x] 54/54 backend tests pass
- [x] Non-blocking concurrent dispatch (removed one-active-per-operator queue blocking)
- [x] Payload-in-reply matching (`payloadInReply()` with phone normalization)
- [x] Training data imported (144 xlsx samples → reply-patterns.json)
- [x] Group-membership Telegram authorization (empty authorizedUsers = any member)
- [x] Timeout re-notification fix (seed notifiedSet on bridge restart)
- [x] Request ID removed from Telegram replies
- [x] Android app UI redesign (hero status, stats counters, collapsible details, branded icon)
- [x] Test Request moved from main screen to Settings
- [x] Home PC configured and tested (config files, adb install)
