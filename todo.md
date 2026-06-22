# Todo

Start with `progress_tracker.md` for the latest session handoff, test results, and environment details.

---

## Done — 2026-06-23: Opened group auth for forwarded messages + forward-aware tagging

Two issues found and fixed, both related to officers forwarding requests from
colleagues into the Telegram group:

1. **Group auth was too restrictive.** The `authorizedUsers` whitelist in
   `config/telegram.json` gated both private DMs and group submissions. Adding
   the Addl SP's Telegram ID (needed for private-DM access on 2026-06-20) closed
   the group — every other officer's messages were silently rejected as
   "unauthorized group sender." VPS logs confirmed 5+ distinct officers blocked
   (Muladi Circle, OC Hijla, OC Babugong, Oc Gournadi, Bakerganj Circle).
   **Fixed:** `planIntake()` no longer checks `authorizedUsers` for group chat
   messages. Any group member can submit. Private DM gating unchanged.
2. **Forwarded message tagging.** `planIntake()` now detects `forward_from` /
   `forward_sender_name` and stores the original author as `forwardedFrom`
   metadata for audit. Replies always tag `message.from` (the group member who
   forwarded), never the original external author.
- Recovered 3 silently rejected requests by manual API resubmission
  (REQ-0285 IMEI-MS 4 IMEIs, REQ-0286 LCL, REQ-0287 LRL).
- 19 bridge tests pass (2 new for forwarded message tagging).

## Done — 2026-06-22: Fixed deploy.sh clobbering runtime Telegram config + bot scolding forwarded messages

Two real bugs reported by the user, both confirmed against live VPS logs/config
before fixing:

1. **`deploy.sh` was silently wiping `authorizedUsers` on every deploy.**
   It unconditionally `scp`'d the local `config/telegram.json` over the VPS's
   runtime copy. The authorized officer added via the admin console the night
   of 2026-06-20 only ever existed in the VPS's runtime file — the next
   `bash scripts/deploy.sh` run (same night, shipping the reply-matching fix)
   clobbered it back to `authorizedUsers: {}`, and the officer's private DMs
   were silently rejected from that point on (`intake: unauthorized private
   sender 8914564310` — confirmed in `pm2 logs sms-bridge`). Fixed: `deploy.sh`
   now only copies `config/telegram.json` if it doesn't already exist on the
   VPS (first-time bootstrap) — once present, it's runtime-owned by the admin
   console/app and never overwritten by a deploy. Re-added the wiped officer
   and synced the local file to match so this doesn't drift again.
2. **The bot was replying "Unsupported command" to its own forwarded/quoted
   output.** No code distinguished "someone forwarded the bot's previous
   answer back into the group" (common — sharing a result with another
   officer) from "someone typed a malformed command." Fixed: `planIntake()`
   recognizes fingerprints of our own output (`\nProcessed at:` from combined
   replies, the `✅ Request received` ack, the literal "Unsupported
   command..." text) and silently ignores them.
- Verified: 141 tests pass (3 new in `test/telegramBridge.test.js`), deployed,
  confirmed `config/telegram.json` survived the deploy this time, confirmed
  the bridge restarted with the officer's DM access restored.

## Done — 2026-06-22: Confirmed group is command-only by policy; added Rejected Messages visibility

Followed up on the "Unsupported command" investigation above. Pulled the exact
raw text of two real past rejections straight from the SQLite `audit_logs`
table (bridge logs at the time didn't capture it): a forwarded WhatsApp-style
chat log (`[21/06, 20:36] Si Morsed Hizla: IMEI-MS 864268073757900`, prefixed
per-line so the parser's first token was `[21/06,` not `IMEI-MS`) and a
Bengali Zoom-meeting announcement posted by "LIC Barisal."

- Initially shipped a fix (`looksLikeCommandAttempt()`) that suppressed the
  "Unsupported command" reply for messages that didn't look like a real
  command attempt. **Reverted per explicit instruction**: the group is
  command-only by policy — no other message should be tolerated there at all,
  so every non-command message should keep getting flagged, including
  forwarded logs and announcements. `telegram-bridge/bridge.js` is back to
  always replying to `UNSUPPORTED_COMMAND` (unless it's an authorization-style
  suppression, which is a separate, intentional policy).
- The real, valid complaint was **visibility**, not over-flagging: there was
  no way to see what a "wrong message" actually said without querying the
  SQLite `audit_logs` table by hand. `/api/admin/audit` only returns the most
  recent 250 audit rows total — with ~40+ `SMS_INBOUND`/`SMS_REPLY_UNMATCHED`
  rows per hour on a busy day, a `REQUEST_VALIDATION_FAILED` entry can scroll
  out of that window within an hour.
- Added `GET /api/admin/rejected-messages` (admin-gated) — reads the full
  in-memory audit log (not the 250-row slice), filters to
  `REQUEST_VALIDATION_FAILED` only, returns up to 200 with full untruncated
  `rawText`, requester, chat, and error code. New "Rejected Messages" tab in
  the web admin console (`public/admin.html`/`admin.js`) lists them with a
  detail pane showing the complete original text — no more digging through
  logs or the database to see what was actually rejected.
- Verified live in the browser preview: submitted the real forwarded-chat-log
  text against the local dev backend, confirmed it appears in the new panel
  with full multi-line text intact, confirmed detail pane renders correctly.
  141 tests still pass (no test changes needed for this pass — the revert
  brought `test/telegramBridge.test.js` back in line with the original
  strict-enforcement test, and the new endpoint is a straightforward audit
  filter with no new business logic to unit test beyond what's already
  covered).

## Planned — Domain migration: `licbarishal.duckdns.org` → `opsbarishal.com`

Not started yet — buying the domain first. Full step-by-step procedure,
rollback plan, and the one known non-zero-downtime gap are documented in
`docs/domain-migration-plan.md`. Short version: nothing in the codebase
hardcodes the duckdns domain (Telegram bridge uses localhost, Android app has
no hardcoded domain) — the only things that need updating are nginx's TLS
config on the VPS (`scripts/setup-ssl.sh`, already parameterized) and each
gateway phone's Backend URL setting.

## Done — 2026-06-20 (night): Fixed reply-type misclassification + added correction tooling

Real incident: a requester's `LRL 01718589986` private-DM request got the wrong
answer delivered — an unrelated GP reply ("Sorry No records found for IMEI:
353917104327090 [GP]") was auto-matched onto it, and the real LRL reply (which
arrived two minutes later with full location data) found nothing left to
attach to and was silently dropped.

- **Root cause**: `src/replyAnalyzer.js`'s IMEI/NID strong-type regexes were
  line-anchored (`(?:^|\n)\s*imei[:\s]`), so GP's "no records found" template
  (keyword mid-sentence) never registered as IMEI-typed. The reply scored
  type-neutral, and the single-pending-request fallback in
  `findActiveRequestForGateway` — payload-blind by design — accepted it since
  it was the only open request on that gateway at the time.
- **Fix**: added unanchored fallback patterns for IMEI/NID "no records found"
  replies, so `replyTypeScore` now correctly rejects a same-gateway reply whose
  type doesn't match the request, even with only one candidate pending.
- **New correction tooling** (for cases like this where a wrong match already
  finalized): `service.rankReplyCandidates(inboxId)` ranks every plausible
  request — including already-`COMPLETED` ones — using the exact same scoring
  as live auto-matching; `service.correctMatch(inboxId, requestId)` re-attaches
  the orphaned reply, detaches the wrongly-matched one, and posts a new
  `⚠️ Correction —` reply instead of silently rewriting history. New endpoints:
  `GET /api/admin/unmatched/:id/candidates`, `POST /api/admin/correct-match`.
  The web admin console's unmatched-SMS panel now shows ranked candidates with
  scores instead of a flat unranked list.
- **Recovered tonight's actual stuck request** (`REQ-20260620-0118-D5UQ`) live
  via the new endpoint — the correct LRL answer was posted to the requester's
  private chat with a correction note.
- Verified: 138 tests pass (5 new in `test/replyMatching.test.js`, regression
  reproduces the exact GP message), deployed to VPS, confirmed `POSTED_LIVE`
  on the live correction draft.

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

## Roadmap (Priority Order)

### P0 — Operational (do first)

- [ ] **Review reply timeout window** — current 15-minute reply window may be too short for some operators (LCL queries can take 4+ minutes at GP alone; Banglalink/Robi may be slower). Evaluate from production data whether 15 min is sufficient or needs tuning per operator.
- [ ] **Add second authorized DM user** — currently only Addl SP Crime & Ops (ID `8914564310`) can DM the bot privately. Add the user's own Telegram ID via the admin console or `POST /api/admin/settings/authorized-users`. Requires `pm2 restart sms-bridge` after adding.
- [ ] **Domain name** — migrate from `licbarishal.duckdns.org` to `opsbarishal.com`. Full plan in `docs/domain-migration-plan.md`. Buy domain first, then DNS + nginx TLS + gateway phone URL update.
- [ ] **Release gateway phone settings from PIN lock** — Backend URL, Gateway ID, SIM slot selection should be freely editable without PIN. Only admin/system settings stay behind PIN: admin API key, secondary gateway ID, test connection, PIN management itself.

### P1 — Security & Access Control

- [ ] **Daily security audit routine** — automated daily health check: gateway connectivity, stuck requests, unmatched SMS count, rejected messages, unauthorized access attempts, disk/memory usage. Posts a digest to a private Telegram chat or admin DM at a fixed time. Catches anomalies (sudden spike in unauthorized attempts, gateway going offline, DB growing too large) before they become incidents.
- [ ] **Web admin login system** — currently admin console is protected only by API key in the request header. Add a proper login page with session tokens, password hashing (bcrypt), and session expiry. Three roles: (1) **admin** — full access including settings, user management, corrections; (2) **operator** — view requests and replies only; (3) **gateway** — phone registration and heartbeat only (already uses gateway secrets, formalize it).
- [ ] **HTTPS for backend API** — gateway phones currently talk to `http://45.77.240.195:3000` (plain HTTP). After domain migration, enforce HTTPS for all API traffic (nginx already terminates TLS for the public host; extend to the API port or unify under one origin).
- [ ] **Rate limiting** — protect the API from brute-force API key guessing and accidental request floods. Simple in-memory rate limiter per IP (e.g., 60 requests/minute for admin endpoints, 120/minute for gateway polling).
- [ ] **API key rotation** — ability to rotate the admin API key and gateway secrets without downtime. New key activates immediately; old key stays valid for a grace period (e.g., 1 hour) so running clients can be updated.
- [ ] **Audit log tamper protection** — current audit log is append-only in SQLite but not cryptographically signed. Add HMAC chain (each entry signs the previous hash) so tampering is detectable.

### P2 — UI/UX Overhaul

- [ ] **Web admin console redesign** — full UI/UX overhaul using modern design tools (21.dev, Google Stitch, Claude design). Current admin console is functional but plain HTML/JS. Target: professional command-center look with real-time updates, dark/light themes, responsive layout, proper data tables with filtering/sorting/export.
- [ ] **Android admin app polish** — increase fidelity against the Stitch design references at `docs/Design/android-admin-stitch/`. Focus areas: typography, spacing, color consistency, loading states, error states, empty states, pull-to-refresh animations, proper Material 3 components.
- [ ] **Android gateway app UI refresh** — match the admin app's visual language. Current gateway app is utilitarian; add status indicators, connection quality display, SMS queue visualization, and cleaner settings flow.

### P3 — Backend Improvements

- [ ] **Nightly DB backup on VPS** — cron job with rotation (keep last 7 days)
- [ ] **Retry failed gateway sends** — exponential backoff when phone HTTP returns error
- [ ] **Teletalk operator** — add `010x` prefix to `domain.js` if needed
- [ ] **Unmatched SMS cleanup** — auto-archive unmatched SMS older than 7 days to keep the count meaningful. Current 2500+ unmatched is mostly spam noise.
- [ ] **Request analytics dashboard** — daily/weekly/monthly request counts by type, operator, requester. Average response times per operator. Helps identify slow operators and heavy users.

### Previously completed

- [x] Robi phone setup — installed v2.3.0, registered on VPS
- [x] SSH key on VPS — passwordless deploy
- [x] MS-NID single-operator routing — routes by MSISDN prefix
- [x] Telegram open-group auth — any group member can submit
- [x] Late reply matching — replies after finalization matched and re-posted
- [x] Multi-operator live posting — NID-MS/IMEI-MS post on first reply, new message per update
- [x] Auto-correct type-token typos — split commands, glued prefixes, `+880` strip, separator strip
- [x] Specific validation error messages — NID/IMEI/MSISDN cross-detection, strict lengths
- [x] Multi-operator reply posting fix — new Telegram message per update
- [x] Open group auth for forwarded messages — any group member can forward, `authorizedUsers` only gates DMs
- [x] Forward-aware tagging — replies tag the group member who forwarded, not the original author

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
- [ ] **Log rotation** — cap Room DB log size on Android

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
