# Todo

Start with `progress_tracker.md` for the latest session handoff, test results, and environment details.

---

## Home PC — First Actions (Next Session)

- [ ] `git pull`
- [ ] Create `config/telegram.json` (copy from example, fill in bot token + group ID + officer IDs)
- [ ] Create `config/gateways.json` (copy from example, add `01936759367` to trustedSenders, set testDestination)
- [ ] Run `start-all.bat`
- [ ] Open Android app → Start Service → confirm "Backend: connected"
- [ ] Send test in Telegram group: `LRL 01724761972`
- [ ] Confirm bot acks, SMS arrives at `01936759367`, reply posts back in Telegram

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

## Backend — Reply Matching (High Priority)

- [ ] **Content-based disambiguation** — when multiple requests are pending for the same operator, use `analyzeOperatorReply()` confidence scores to pick the best match instead of returning `null`
- [ ] **Training data pipeline** — when a reply is matched (even by time window), save its keywords to `data/reply-patterns.json` automatically for future improvements
- [ ] **Request type detection from reply** — detect reply type from content and match to pending requests of that type

---

## Backend — General

### High Priority
- [ ] **Retry failed gateway sends** — exponential backoff when phone HTTP returns error
- [ ] **Manual review actions** on dashboard — reject, retry, edit-before-approve
- [ ] **Gateway health dashboard** — show online/offline, last-seen, stale queue alert
- [ ] Remove `Review confidence` line from combined draft (no extractors planned)

### Medium Priority
- [ ] **Phone health checks** — dashboard shows gateway online/offline + last registered time
- [ ] **Audit export** — CSV download of full audit log for evidence purposes
- [ ] **Alerting** for stuck queues and timeout spikes
- [ ] **Windows service** — run backend as NSSM service so it survives PC reboots

---

## Telegram Bridge

- [ ] **Operator-specific routing** — allow officer to specify operator in message (e.g. `LRL 017xxx GP`) to target a single operator instead of all
- [ ] **Timeout notification** — when all dispatches time out, post "No reply received" in-thread to Telegram
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

- [ ] Add real operator replies as training samples in `Training Data/` Excel files
- [ ] Run `npm run import:training` after every update
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
