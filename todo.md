# Todo

Start with `progress_tracker.md` for the latest session handoff, test results, and environment details.

---

## Quick Start (VPS is always on — no local backend needed)

Backend and Telegram bridge run permanently on the VPS. Nothing to start on your PC.

To check VPS status:
```bash
ssh root@45.77.240.195
pm2 status
```

To restart everything on VPS after a code update:
```bash
cd /opt/sms-backend && git pull && npm install && pm2 restart all
```

---

## Setting Up a New Gateway Phone

1. Install the app: `adb install -r app-release.apk` (via USB) or send APK via **Admin Panel** on A55
2. Open app → **Settings**:
   - Backend URL: `http://45.77.240.195:3000`
   - Gateway ID: `GP_PHONE_01` / `BANGLALINK_PHONE_01` / `ROBI_PHONE_01`
   - SIM: select correct slot
   - Gateway Secret: (leave blank for now)
3. Tap **Save** → **Start**
4. Check VPS logs: `pm2 logs sms-backend --lines 20`

---

## Immediate Next (Priority Order)

- [x] **Robi phone setup** — installed v2.0.1, registered on VPS, LCL confirmed 2026-06-14
- [x] **Battery optimization exemption** — v2.0.2: prompts to exempt on first launch after permissions granted
- [ ] **SSH key on VPS** — run `ssh-copy-id root@45.77.240.195` from PC to avoid password prompts

---

## Android Gateway App — Wave 4

- [x] **Battery optimization exemption** — done in v2.0.2
- [ ] **Idempotency key** on inbound webhook — SIM slot + timestamp + sender hash; backend deduplicates
- [ ] **EncryptedSharedPreferences** for API key storage
- [ ] **compileSdk/targetSdk bump** to 35

---

## Backend

- [ ] **Nightly DB backup on VPS** — cron job: `cp data/automation.db data/automation.db.bak`
- [ ] **Retry failed gateway sends** — exponential backoff when phone HTTP returns error
- [ ] **Auto-save training data** — when reply matched, append keywords to `data/reply-patterns.json`

---

## Production Readiness

- [ ] **Robi phone** — hardware pending
- [ ] **SSH key on VPS** — passwordless access
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
- [x] Android UI redesign (hero status, stats, collapsible details)
- [x] Polling architecture (phone polls VPS every 3s — no push needed)
- [x] Dual-SIM support (BANGLALINK SIM 1 + GP SIM 2 on one phone)
- [x] OTA update system (UpdateChecker, UpdateInstaller, Admin Panel publish)
- [x] Admin Panel on A55 (gateway health dashboard, publish APK)
- [x] Check for Update menu option
- [x] /setup web page for admin key creation
- [x] Telegram offset persistence (no messages lost on restart)
- [x] VPS deployment — Vultr Singapore, PM2, Node 22, UFW
- [x] GP E2E test PASSED on VPS
- [x] Banglalink E2E test PASSED on VPS
- [x] v2.0.1 — SmsReceiver dual-SIM inbound routing fix
