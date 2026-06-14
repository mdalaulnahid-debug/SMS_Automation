# Todo

Start with `progress_tracker.md` for the latest session handoff, test results, and environment details.

---

## Quick Start (VPS is always on — no local backend needed)

Backend and Telegram bridge run permanently on the VPS. Nothing to start on your PC.

To deploy code changes:
```bash
bash scripts/deploy.sh
```

To check VPS status:
```bash
ssh root@45.77.240.195
pm2 status
```

---

## Setting Up a New Gateway Phone

1. Install the app via USB: `adb -s <device-id> install -r app-release.apk`
   Or publish OTA via Admin Panel on A55
2. Open app → **Settings**:
   - Backend URL: `http://45.77.240.195:3000`
   - Gateway ID: `GP_PHONE_01` / `BANGLALINK_PHONE_01` / `ROBI_PHONE_01`
   - SIM: select correct slot
3. Tap **Save** → **Start**
4. Check VPS logs: `pm2 logs sms-backend --lines 20`

---

## Immediate Next (Priority Order)

- [x] **Robi phone setup** — installed v2.3.0, registered on VPS
- [x] **SSH key on VPS** — passwordless deploy via `bash scripts/deploy.sh`
- [x] **MS-NID single-operator routing** — routes by MSISDN prefix, not all operators
- [x] **Telegram open-group auth** — any group member can submit
- [x] **Late reply matching** — replies arriving after finalization are now matched and re-posted
- [ ] **Multi-operator live posting** — NID-MS and IMEI-MS post immediately on first reply, edit as more come in *(design reviewed, pending implementation)*

---

## Multi-Operator Live Posting (NID-MS / IMEI-MS) — Design

**Behaviour:**
- When first operator replies → immediately post to Telegram group:
  ```
  @Requester
  NID-MS: <payload>

  — GP: [reply text]
  — Robi: pending...
  — Banglalink: pending...
  ```
- When next operator replies → **edit** that same Telegram message to fill in their slot
- When last operator replies → edit again, all slots filled
- If operator times out → edit to show "no reply (timed out)"

**Applies to:** NID-MS and IMEI-MS only (multi-operator fan-out requests)
**Does not affect:** LRL, LCL, MS-NID (single-operator, unchanged)

**Open design questions (to answer before coding):**
1. If a second reply arrives from an already-replied operator — update or ignore?
2. If Telegram edit fails (>48h old message) — fall back to new message?
3. If `autoApprove` is false — does reviewer approve once (first post) and subsequent edits are automatic?

---

## Android Gateway App — Wave 4

- [x] **Battery optimization exemption** — done in v2.0.2
- [x] **SIM phone number in registration** — done in v2.3.0
- [ ] **Idempotency key** on inbound webhook — SIM slot + timestamp + sender hash; backend deduplicates
- [ ] **EncryptedSharedPreferences** for API key storage
- [ ] **compileSdk/targetSdk bump** to 35

---

## Backend

- [ ] **Nightly DB backup on VPS** — cron job: `cp data/automation.db data/automation.db.bak`
- [ ] **Retry failed gateway sends** — exponential backoff when phone HTTP returns error
- [ ] **Teletalk operator** — add 010x prefix to domain.js if needed

---

## Production Readiness

- [x] **Robi phone** — confirmed working
- [x] **SSH key on VPS** — passwordless access
- [ ] **Log rotation** — cap Room DB log size on Android
- [ ] **Domain name for VPS** — instead of bare IP (optional)

---

## Training Data

- [x] 144 xlsx samples imported to `data/reply-patterns.json`
- [ ] Add real GP LRL reply from E2E test as reference sample
- [ ] Add Robi and Banglalink reply samples when available

---

## Completed (archive)

- [x] Phase 0 fixes, first E2E test
- [x] SQLite persistence, per-operator dispatches
- [x] Security — admin key, gateway secrets, audit chain
- [x] Telegram bridge — intake, posting, threaded replies, autoApprove
- [x] Android Wave 1 — auth, signing, Gradle wrapper
- [x] Android Wave 2 — SIM picker, READ_PHONE_STATE
- [x] Content-based reply disambiguation, dashboard actions
- [x] Non-blocking concurrent dispatch, payload-in-reply matching
- [x] Training data imported (144 rows)
- [x] Android UI redesign (hero status, stats, SIM switcher, admin dark theme)
- [x] Polling architecture (phone polls VPS every 3s — no push needed)
- [x] Dual-SIM support (BANGLALINK SIM 1 + GP SIM 2 on one phone)
- [x] OTA update system (UpdateChecker, UpdateInstaller, Admin Panel publish)
- [x] Admin Panel on A55 (gateway health dashboard, publish APK)
- [x] /setup web page for admin key creation
- [x] Telegram offset persistence (no messages lost on restart)
- [x] VPS deployment — Vultr Singapore, PM2, Node 22, UFW
- [x] GP E2E test PASSED on VPS
- [x] Banglalink E2E test PASSED on VPS
- [x] Robi E2E test PASSED on VPS
- [x] v2.0.1 — SmsReceiver dual-SIM inbound routing fix
- [x] v2.0.2 — Battery optimization exemption (Samsung kill fix)
- [x] v2.3.0 — SIM phone number registration + admin card display
- [x] MS-NID → RELEVANT_OPERATOR (single operator by prefix)
- [x] Telegram open-group auth (any group member can submit)
- [x] Late reply matching + re-posting (6-hour window)
- [x] One-command deploy script (`scripts/deploy.sh`, passwordless SSH)
