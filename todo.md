# Todo

Start with `progress_tracker.md` for the latest session handoff, test results, and environment details.

---

## Done — 2026-06-20: Telegram private-DM intake

Authorized users can now message the bot directly (1:1 DM) instead of only
through the shared group, with replies routed back to that same private
chat — useful when a request/reply shouldn't be visible to the whole group.

- `telegram-bridge/bridge.js` `planIntake()`: a message is processed if it's
  from the configured group OR from any private chat (`chat.type ===
  'private'`). Private chats are **always** authorized-only via
  `config.authorizedUsers` — there's no "open" equivalent of group
  membership for a 1:1 chat with the bot. Unauthorized senders (group or
  private) are silently ignored — no reply, ever — consistent with the
  "all authorization failures stay silent" decision from earlier this
  session.
- **Real bug fixed in the same pass**: `handleIntake()`'s ack and
  rejection messages used to hardcode `chatId: config.groupChatId` — a
  private-DM submission's ack/rejection would have been sent to the
  *group*, not back to the requester. Now uses `plan.request.chatId`,
  so replies always go to whichever chat the request actually came from.
- **Closed the audit gap** noted in the previous safeguard work:
  unauthorized attempts (group allowlist rejection, or any unauthorized
  private DM) are now reported once per (chat, sender) to
  `POST /api/telegram/unauthorized-attempt` → `TELEGRAM_UNAUTHORIZED_ATTEMPT`
  audit entry, surfaced as `telegramUnauthorizedAttempts24h` +
  `recentUnauthorizedAttempts` on `/api/dashboard`, with a KPI tile and
  alert banner in the web admin console (mirrors the chat-mismatch
  safeguard pattern).
- **Operational, not code**: to actually let someone use this, get their
  numeric Telegram user ID (e.g. via `@userinfobot`) — see the next entry
  for how to add them without touching the JSON file directly. The user
  must also message the bot first (`/start` or anything) — Telegram never
  lets a bot initiate contact, so being on the allowlist alone doesn't
  make the bot reach out.
- Verified: 128 tests pass, plus a live browser-preview round-trip of the
  new unauthorized-attempt endpoint (KPI tile + alert banner both render
  correctly).

## Done — 2026-06-20: Manage authorized Telegram users from the UI

Adding/removing authorized users no longer requires SSH + hand-editing
`config/telegram.json` — both the web admin console and the Android Admin
App can do it now, same pattern as the Telegram group/operator-hotline
settings added earlier this session.

- `src/settingsStore.js`: `readAuthorizedUsers()`, `writeAuthorizedUser(id,
  name)`, `removeAuthorizedUser(id)` — merge into `authorizedUsers` in
  `config/telegram.json`, preserving every other field/entry.
- New admin-gated endpoints: `POST /api/admin/settings/authorized-users`
  (add/update) and `POST /api/admin/settings/authorized-users/remove`;
  `GET /api/admin/settings` now also returns the current list.
- Web admin console: an "Authorized Telegram Users" block in the Tools tab
  Settings panel — list with per-row Remove buttons, plus an Add form.
- Android Admin App: the same thing, in the Settings screen's
  "OPERATIONAL SETTINGS" panel — dynamically rendered rows with Remove
  buttons, plus the Add form. Verified by screenshot on the A55 (empty
  state and form both render correctly; didn't test an actual add/remove
  against production from the device, since the web-console round-trip
  already proved the same backend logic end-to-end against a local dev
  server).
- Same restart caveat as the group chat ID: adding/removing takes effect
  only after `pm2 restart sms-bridge` — both UIs say so after a save.
- Verified: 133 tests pass (11 in `test/settingsStore.test.js` now, up
  from 6), plus a live browser-preview add → list → remove round-trip.

## Resolved — From 2026-06-19/20 Sessions

All of the following were verified resolved in code during the 2026-06-20
review pass (re-read the relevant source before re-opening any of these):

- **Reply correlation hardening** — `src/store.js` `findActiveRequestForGateway()`
  no longer prioritizes `WAITING_OPERATOR_REPLY` over `NEEDS_MANUAL_REVIEW`/`TIMEOUT`
  candidates; `src/replyAnalyzer.js` `inferReplyFamilies()` + `src/service.js`
  `replyTypeScore()` now refuse to auto-match a reply whose inferred family
  doesn't include the request's actual type (`SMS_REPLY_TYPE_MISMATCH` audit
  instead of a silent wrong-match), for both single-candidate and ambiguous
  multi-candidate cases.
- **Training data** — the five curated `Training Data/Automation/*.xlsx`
  workbooks are the active baseline, built into `data/training-cache/` by
  `src/trainingData.js`. The old self-reinforcing `saveMatchedReplyKeywords()`
  auto-learn-into-baseline mechanism was removed entirely.
- **Self-training storage** — `src/manualReviewStore.js`, capped per request
  type (not globally) at the latest 100 entries, stored under
  `data/manual-review/<TYPE>.json`, wired into `service.js` by default. Never
  feeds back into matching automatically — promotion into the curated
  workbooks is a manual step.
- **Unauthorized rejections silenced in the group** — `telegram-bridge/bridge.js`
  `shouldSuppressGroupReply()` suppresses all three backend-level
  authorization error codes; format/duplicate rejections still post normally.
- **Watchdog alerts no longer fall back to the group** — `sendTelegramWatchdogAlert()`
  in `src/app.js` only sends to `watchdogAlertChatId`, never the main group.

**One small residual gap, low priority (inactive today):** the bridge-level
`authorizedUsers` allowlist rejection still never reaches the backend, so even
though it's silent in the group now, it's also not audit-visible. Moot while
`authorizedUsers: {}` is empty in production config — revisit if that
allowlist is ever turned on.

## Done — 2026-06-20: Telegram chat-mismatch safeguard + authenticated settings

Root cause of the "bridge stopped working" incident: the VPS's
`config/telegram.json` `groupChatId` had drifted from the real group, so
every message was silently logged as "ignored" with no admin-visible signal.
Fixed in two parts:

1. **Safeguard** — `telegram-bridge/start.js`'s loop used to short-circuit
   wrong-chat messages before ever reaching `bridge.js`'s `handleIntake()`/
   `planIntake()`, which already had unused "wrong chat" handling. Consolidated
   onto one path: `handleIntake()` now reports a mismatch once per distinct
   wrong chat id (in-memory dedupe Set owned by the loop) via
   `backendClient.reportChatMismatch()` → `POST /api/telegram/chat-mismatch`
   (admin-key gated) → `TELEGRAM_CHAT_MISMATCH` audit entry, surfaced as a
   `telegramChatMismatches24h` stat and `recentChatMismatches` diagnostic on
   `/api/dashboard`, with a KPI tile + alert banner in the web admin console.
2. **Authenticated settings** — `src/settingsStore.js` provides admin-gated
   read/write for the Telegram group chat id (`config/telegram.json`) and
   per-operator hotline/shortcode numbers (`config/gateways.json`), via
   `GET /api/admin/settings`, `POST /api/admin/settings/telegram-group`, and
   `POST /api/admin/settings/operator-contact`. A "Settings" panel in the web
   admin console's Tools tab provides the input UI (previously only doable by
   SSH-ing into the VPS and hand-editing JSON). Operator shortcode changes
   apply live without a restart; Telegram group changes need
   `pm2 restart sms-bridge` since that's a separate long-lived process that
   reads its config once at startup — the UI says so after saving.

Not done (deliberately out of scope, no Android app changes this pass): the
same settings UI in the Android Admin App. The web admin console route was
chosen as the lower-risk option per "admin app or backend admin console,
whichever."

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
- [x] **Multi-operator live posting** — NID-MS and IMEI-MS post immediately on first reply, new message for each update
- [x] **Auto-correct type-token typos** — `MS NID` → `MS-NID`, glued prefixes, `+880` country code, separator stripping
- [x] **Specific validation error messages** — NID/IMEI/MSISDN cross-detection, digit count hints, strict NID (10/13/17) and IMEI (14/15) lengths
- [x] **Multi-operator reply posting fix** — each operator reply posts as a new Telegram message instead of editing the previous one
- [ ] **Release gateway phone settings from PIN lock** — Backend URL, Gateway ID, SIM slot selection should be freely editable without PIN. Only admin/system settings stay behind PIN: admin API key, secondary gateway ID, test connection, PIN management itself.

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
- [x] Multi-operator live posting (NID-MS, IMEI-MS) — post on first reply, new message per update
- [x] Auto-correct type-token typos (`MS NID` → `MS-NID`, glued prefixes, `+880` strip, separator strip)
- [x] Specific validation errors (NID/IMEI/MSISDN cross-detection, digit count, strict lengths)
- [x] Multi-operator reply: new Telegram message per update instead of editing in-place
