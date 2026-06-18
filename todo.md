# Todo

Start with `progress_tracker.md` for the latest session handoff, test results, and environment details.

---

## Pending — From 2026-06-18 Session (start here next)

Two items agreed on but paused mid-session — pick up exactly here, don't re-derive.

### 1. Auto-correct type-token typos in `src/parser.js` — scoped, ready to implement

Agreed earlier the same day, then reversed by a later commit (`8bd26a5`/`c26b896`)
which shipped strict-rejection-only instead. User confirmed they want the
original auto-correct behavior after all. See `docs/multi-number-batching-plan.md`
("Decision that changed") for the full history.

**Scope (already agreed, do not re-litigate):**
- Only fix the **command keyword** spacing/gluing — e.g. `MS NID 0162...` →
  `MS-NID 0162...`, `LRL01308-218563` → `LRL 01308-218563`.
- **Never** touch the digits inside the identifier itself. If the corrected
  identifier is still malformed (e.g. a stray hyphen inside the number), it
  must still fail normally (`INVALID_IDENTIFIER_CHARS` / `INVALID_IDENTIFIER_FORMAT`)
  — auto-correct fixes the boundary between command and value, nothing else.
- Two concrete patterns to handle in `parseRequestText()` before the existing
  strict-match logic in `src/parser.js`:
  1. Two leading tokens form a known hyphenated command when joined —
     `MS` + `NID` → `MS-NID`, `NID` + `MS` → `NID-MS`, `IMEI` + `MS` → `IMEI-MS`.
  2. First token has a known command as a glued prefix, optionally followed
     by one connecting hyphen, then digits — split it into the command token
     plus the remainder (remainder is NOT otherwise modified).
- Add test cases to `test/workflow.test.js` for both patterns, plus a case
  confirming a still-malformed remainder after correction is rejected.
- Estimated effort: ~10-15 minutes (one parser function + tests + run suite + commit).

### 2. Stop posting unauthorized-sender rejections into the Telegram group — needs scope answers first

User's request: unauthorized messages currently get posted back into the
shared Telegram group; this should stop, and those events should only be
visible via the web admin console or Android admin app instead.

**What was found (don't re-derive):**
- Two separate authorization mechanisms exist, both currently posting their
  rejection text back into the group via `telegram-bridge/bridge.js`'s
  `handleIntake()`:
  1. **Bridge-level allowlist** (`telegram-bridge/bridge.js` `planIntake()`,
     `config.authorizedUsers` + `config.replyToUnauthorized` in
     `config/telegram.json`). Currently **inactive** — `authorizedUsers: {}`
     is empty, so `hasAllowList` is false and nobody is actually blocked here
     today. This path never calls the backend at all, so even if active,
     today it would NOT show up in admin/web audit — needs a new backend
     endpoint for the bridge to report it if we want it audit-visible.
  2. **Backend-level checks** in `src/service.js` `submitRequest()`
     (`denyUnknownRequesters` in `config/auth.json`, currently `false`):
     disabled user (`REQUEST_DENIED_DISABLED_USER`, already audited), unknown
     requester (`REQUEST_DENIED_UNKNOWN_USER`, already audited), and
     per-operator authorization mismatch (lines ~89-98 of `service.js` —
     **not currently audited at all**, a real gap). All three currently
     return a `replyText` that `bridge.js` posts straight into the group.
- Format/duplicate rejections (max-5-identifiers, mixed types, duplicate
  active request, etc.) are a **separate, unrelated category** — these are
  useful self-correction feedback for a legitimate officer's typo, not an
  authorization concern.

**Open questions — asked via AskUserQuestion, user dismissed without
answering, must be resolved before implementing:**
1. Suppress the group reply for *all* authorization-type failures (disabled
   user + unknown requester + operator-not-authorized + bridge allowlist), or
   only the bridge-level allowlist case?
2. Should format/duplicate rejections keep posting to the group as today
   (recommended — they're not an authorization concern), or also move to
   admin-only?

**Once answered, the shape of the fix:**
- Add stable `errorCode`s to the three backend-level authorization paths in
  `service.js` (only `REQUEST_DUPLICATE_BLOCKED`/parser errors have one
  today) so `bridge.js` can reliably tell "suppress this" apart from "show
  this in-group."
- Add the missing audit call for the operator-mismatch path.
- Add a small backend endpoint + `telegram-bridge/backendClient.js` method so
  the bridge-level allowlist rejection (which never touches the backend
  today) becomes audit-visible too, if question 1 says to suppress it.
- In `telegram-bridge/bridge.js` `handleIntake()`, skip the `telegram.sendMessage`
  call for whichever failure types are in scope, per the answers above.

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
2. Open app → **Settings** → tap **Gateway & Connection** (Admin Setup lock) → enter PIN:
   - Backend URL: `http://45.77.240.195:3000`
   - Gateway ID: `GP_PHONE_01` / `BANGLALINK_PHONE_01` / `ROBI_PHONE_01`
   - SIM: select correct slot
   - For dual-SIM (A16): also set Secondary Gateway ID = `BANGLALINK_PHONE_01`, Secondary SIM = SIM 2
3. Tap **Save** → **Start**
4. Check VPS logs: `pm2 logs sms-backend --lines 20`

---

## Immediate Next (Priority Order)

- [x] **Robi phone setup** — installed v2.3.0, registered on VPS
- [x] **SSH key on VPS** — passwordless deploy via `bash scripts/deploy.sh`
- [x] **MS-NID single-operator routing** — routes by MSISDN prefix, not all operators
- [x] **Telegram open-group auth** — any group member can submit
- [x] **Late reply matching** — replies arriving after finalization are now matched and re-posted
- [x] **Multi-operator live posting** — NID-MS and IMEI-MS post immediately on first reply, edit as more come in
- [ ] **[TOMORROW] Release gateway phone settings from PIN lock** — Backend URL, Gateway ID, SIM slot selection should be freely editable without PIN (so gateway phone can be reconfigured if something breaks). Only admin/system settings stay behind PIN: admin API key, secondary gateway ID, test connection, PIN management itself.

---

## Multi-Operator Live Posting (NID-MS / IMEI-MS) — DONE

**Behaviour (implemented):**
- First operator reply → post immediately to Telegram: GP filled, Robi/BL "pending..."
- Each subsequent reply → **edit** same message in-place
- All done or timed out → final edit → request COMPLETED

**Design decisions:**
1. Duplicate operator reply → update (take latest text)
2. Edit fails >48h → falls back to new threaded message
3. autoApprove=false → reviewer approves first post once; all subsequent edits automatic

**Status lifecycle:** `APPROVED_FOR_POST` → `POSTED_LIVE` → `APPROVED_FOR_EDIT` → `POSTED_LIVE` → ... → `POSTED`

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
- [x] Multi-operator live posting (NID-MS, IMEI-MS) — post on first reply, edit as more come in
