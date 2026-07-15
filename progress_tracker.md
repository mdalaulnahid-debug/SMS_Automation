# Progress Tracker

Last updated: **2026-07-15 — React migration (Phases 0/1/1.5 + auth pages), forgot/reset-password (backend + both frontends), production register.html drift discovered & patched, on `feature/security-hardening-v1`, still NOT merged/deployed**

---

## Session Handoff (2026-07-15) — React redesign progress, forgot/reset-password, production deployment-gap discovery

**Branch:** `feature/security-hardening-v1` still, still isolated from `main` for all new backend/vanilla work. New React app lives in `web/` (its own `package.json`, not gated by the branch discipline the same way — but still not deployed).

### React migration (`web/`) — Phases 0, 1, 1.5 + auth pages

Full architecture and phase plan in [`docs/redesign.md`](docs/redesign.md).
Vite + React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui (`base` library).
Design system codenamed **"Signal Room"** (approved after a 3-concept pitch,
Artifact-based comparison): ink-navy `#0a0f1c` dark ground, indigo
`#6e7bff`/`#4f46e5` as the one reserved UI-chrome accent, real GP/Robi/
Banglalink brand hues used only where operator identity is genuine data (the
Telegram Bridge settings page's operator selector), Chakra Petch + Manrope +
IBM Plex Mono.

- **Phase 0** — scaffold, ported design tokens, dev proxy `/api` → `:3000`, Welcome landing page from a fetched Magic MCP (21st.dev) component.
- **Phase 1 / 1.5** — typed API client, auth context, theme provider, `AppShell`, router; Settings rebuilt from one flat 7-form grid into 6 named categories (Profile/Telegram Bridge/Personnel Registry/Provisioning/Developer Tools/Release).
- **Auth pages** — `Login.tsx` (password → MFA state machine, `react-hook-form` + `zod`, `input-otp` for the 6-digit code, step-up re-auth support), `Register.tsx` (full parity with vanilla's registry-match contract), `ForgotPassword.tsx`, `ResetPassword.tsx`.
- **Routing decision (revised this session):** every role lands on `/welcome` after login (not just officers) — `resolveHomeRoute()` no longer branches by role; admin/super_admin get a visible "Admin Console" link in the header instead of being auto-redirected past the landing page.
- One real bug hit and fixed during Login verification: `lib/api.ts`'s `apiFetch` treats any `401` as "session expired, log out" — but `/api/auth/login`/`/api/auth/mfa/verify` legitimately return `401` for wrong credentials. Login/Register/ForgotPassword/ResetPassword all use a separate plain `fetch` for their own endpoints instead of the shared `apiFetch`, to avoid that collision.
- One environment quirk (not an app bug): `computer{action:"left_click"}` doesn't reliably fire on the `@base-ui` `<Button>` primitive in this session's browser tool — worked around with direct `element.click()` JS dispatch throughout. Ground-truth DOM state (className, `.matches()`) was always correct; only the click *simulation* was unreliable.

### Group-registration gate + promote-to-admin (vanilla, `src/app.js`)

Both built and tested earlier this session, now considered done (previously
tracked as "planned" in `todo.md`): `checkRegistration()` soft-nag/hard-block
gate wired into `POST /api/requests`, `GET /api/admin/users` +
`POST /api/admin/users/:id/role` for admin promotion/demotion (super-admin
only, self-role-change blocked, super_admin creation blocked). `public/
welcome.html` (public landing page) added, later became the gated Welcome
page's vanilla counterpart.

### Forgot-password / reset-password — backend + both frontends

`userAuth.js`: `requestPasswordReset(email)` (1-hour single-use token,
returns `null` — not a throw — for a non-matching email, so the API layer can
respond identically either way) and `resetPassword(token, newPassword)`
(invalidates every existing session on the account — a reset is exactly the
moment a hijacked session should stop working). New endpoints `POST
/api/auth/forgot-password` / `POST /api/auth/reset-password` in `app.js`. One
real bug caught during testing: the mail-send call was originally unhandled,
so a transport failure produced a `500` for an existing account vs `200` for
a non-existent one — an email-enumeration side channel. Fixed by swallowing
the mail-send error (logged server-side) so the HTTP response is identical
regardless. Wired into the vanilla site too (`public/forgot-password.html`,
`public/reset-password.html`, link added to `login.html`) and a `/reset-
password` (no-extension) alias added in `app.js` so the emailed link works
today and stays correct once the React app takes over that route at cutover.

`scripts/reset-password.js` (new) — a standalone CLI for resetting a
production account's email/password directly against `data/auth.db`, meant
to be copy-pasted and run by hand over SSH by the account owner. Built after
a real support case (user locked out, needed both email and password
changed) — Claude never handles the plaintext password in any of this; the
script prompts for it interactively on whoever's own terminal runs it.

### ⚠️ Deployment-gap discovery

While patching production's `register.html` (found it missing Designation/
Unit/Phone fields — reported by the user), discovered `feature/security-
hardening-v1` is **40 commits ahead of `main`** and none of it — the entire
V1 hardening initiative, steps 1 through 9 — has ever been merged or
deployed. Production is running pre-hardening code. Applied a cosmetic-only
hand patch directly to production's `register.html` (adds the 3 missing
fields so the form matches what's in this repo) at the user's explicit
request, with the caveat clearly stated that registration won't actually
enforce a registry match until the paired backend commit ships too. **Real
fix is unstarted:** merge the branch to `main` and deploy — needs explicit
sign-off given the size (registry-gated registration will start rejecting
any registrant whose phone+email don't match an imported Personnel Registry
record — a behavior change large enough to need its own conversation).

---

## Session Handoff (2026-07-14) — Security hardening V1 steps 6–10 done + follow-on portal separation

**Branch:** `feature/security-hardening-v1` (isolated from `main`, localhost-only per standing instruction — nothing deployed this session).

### Steps 6–10 of the locked build order (all now done)

Full narrative in [`docs/security-hardening-v1-STATUS.md`](docs/security-hardening-v1-STATUS.md); design in [`docs/security-hardening-v1-design.md`](docs/security-hardening-v1-design.md).

- **Step 6** — Quota + email-OTP re-verification middleware (`src/quota.js`, `src/otp.js`): per-officer rate limiting; breaching it locks the officer out until they verify a 6-digit code emailed to their registered address.
- **Step 7** — Admin group actions: admin/super_admin posts in the Telegram group bypass normal request friction (`isAdminTelegramSender`); moderation commands (`/ban`, `/mute`, `/unmute`, `/unban`) added with authorization checks before any Telegram API call.
- **Step 8** — Shared admin key scoping (**partial by design** — Android Gateway/Admin apps have no session-login of their own, so key auth stays wherever they depend on it). Split into `requireAdmin`/`requireSuperAdmin` (key OR session), `requireAdminSessionOnly`/`requireSuperAdminSessionOnly` (session only), `requireMachine` (key only, Telegram-bridge endpoints).
- **Step 9** — Behavioral anomaly tripwire (`src/anomalyDetector.js`): non-blocking flags for off-hours activity, request bursts, Telegram identity drift, request-type pattern shifts.
- **Step 10** — Local end-to-end simulation of the whole system, run live (not just the automated suite): registration → email → login/MFA → quota breach → OTP recovery → admin bypass → moderation auth → anomaly flags. Two real findings:
  - **Live production bridge detected** — starting the Telegram bridge locally hit a `409 Conflict`, proving a production instance is already live on the VPS. Killed the local one within seconds; never touched the real Telegram API for anything destructive. Remaining Telegram-dependent legs of the E2E test were re-scoped to HTTP-only simulation.
  - **Pre-existing audit-chain bug found and fixed**: `JSON.stringify()` silently drops `undefined`-valued object keys, so `service.js`'s `createRequest()` call (passing `channel`/`chatId`/`sourceMessageId` as `undefined` rather than `null`) caused every persist-and-reload round trip to report false tamper detection — and `verifyAuditChain()` stops at the first mismatch, so this masked any *real* tampering on every row after it. Fixed (normalize to `null`, matching the existing `testDestination` pattern), regression-tested.

Full suite: **316/316**.

### Follow-on: real page separation for Telegram-linked officers

Not part of the original 10 steps — user asked how to stop a Telegram-registered officer from seeing "the original website" at all, rather than just having admin tabs hidden by JS.

- Previously, the "Registered Officer" tier (§4 of the design doc) got the same `index.html`/`app.js` bundle as admins, with admin tabs hidden via `.officer-hide` — the markup/JS still shipped to the officer's browser, just hidden (visible via devtools).
- Fix: reused existing server-side infrastructure (`HttpOnly` session cookie set at login, `guardPage()` gating `GET /`) — a session with `role === 'officer'` **and** a linked `telegram_id` is now served a new, genuinely separate minimal page (`public/portal.html` / `public/portal.js` — account status + sign-out only, no admin markup, never references `app.js`) instead of `index.html`. Officers without a linked Telegram ID are unaffected.
- Verified live locally with two temporary officer accounts (linked/unlinked) and real sessions: server branches correctly, `portal.html` renders real account data, `app.js` is never fetched by the linked officer's browser (checked via network log), sign-out works correctly. Test accounts removed afterward. Suite still 316/316.

**Nothing deployed.** Per this branch's standing instruction, no VPS/production discussion happens until the user explicitly reviews and approves.

---

## Session Handoff (2026-07-06)

**Shipped & deployed:**
- Gateway app v2.7.0(48) + Admin app v0.2.0(2): teal Material-3 theme sync,
  admin console live phone-inbox viewer (Gateways tab: Live Inbox/Refresh per
  card). Installed via USB on both gateway phones + the Galaxy A55 admin device.
- Fixed a real production bug: `authHeaders()` let a stale officer-login
  `sessionToken` silently shadow a freshly-entered admin API key, causing
  "invalid or expired API key" even with the correct key. Fixed in
  `admin.js`/`app.js`; verified live against the backend.
- Diagnosed and fixed a Telegram-group flood incident: the bridge's
  "already notified" seed step had no retry and silently treated failure as
  "nothing to seed," so a restart-time race re-announced ~100 old
  TIMEOUT/FAILED requests at once (some from 2026-06-13), hitting Telegram's
  rate limit. Fixed: `seedNotifiedTimeouts()` retries every poll cycle until
  it succeeds (skipping the notify pass, not replies/edits, until then); all
  outgoing Telegram sends now throttled/serialized with 429 backoff via
  `telegramClient.js`. 161/161 tests pass. Verified live — the same race
  recurred on this deploy's restart and correctly paused instead of flooding.
- Fixed the graphify post-commit hook: `.graphify_root` stored an MSYS-style
  path a native Windows Python misread, silently breaking every rebuild since
  2026-07-04. Fixed + full rebuild (14,502 nodes). Standing rule now: fold
  the regenerated graph into the next commit automatically.

**Designed, not started — `P2`:** Lost/Stolen Phone Recovery Watch
(GD-linked). Full write-up in
[`docs/gd-lost-phone-watch-design.md`](docs/gd-lost-phone-watch-design.md),
tracked in `todo.md`. Must be built and tested entirely on localhost before
any deployment discussion.

---

## Current Stage

**2026-07-04:** the web UI was redesigned and **deployed to the VPS** (commit
`97e691a`; docs `86c86e8`; both pushed to GitHub). Shipped: a full Material-3
"ROMER Command Grid" reskin (teal accent, surface-container elevation ramp),
the 1a "Deep Command" ops refinements, and a restructured admin **Approvals
Queue** master-detail. Both PM2 services restarted cleanly; verified live. The
4 admin authorized users were synced local↔VPS and `sms-bridge` restarted to
activate the 2 newest officers. See Session Handoff (2026-07-04) below.
**Follow-up:** the Android apps' `colors.xml` were not re-synced to the teal
ramp, so web/Android design-token parity is currently broken.

Phase 0 (retried-request reply auto-matching bug) is fixed and deployed
(`0c4839b`). Phase 1.0 (officer/admin login backend) is implemented and
tested locally but **not yet deployed to the VPS** — see Session Handoff
below before continuing. 148 tests pass locally.

**Open item (resolved this session)**: `support@opsbarishal.com` is now a
live forwarding address — Cloudflare Email Routing forwards it to
`opsbarishal@gmail.com`, which sends outbound mail via Gmail SMTP (app
password, confirmed working with a live test send).

**Open item (new)**: `config/mail.json` (Gmail app password + super-admin
bootstrap credentials) is gitignored by design and must be created by hand
directly on the VPS before deploying this session's auth code — it will
NOT arrive via `scripts/deploy.sh` or `git pull`.

Earlier this session: group auth was too restrictive — adding a user to
`authorizedUsers` (for private-DM gating) had closed the group to all
non-whitelisted members. Fixed: group chat is now always open; `authorizedUsers`
only gates private DMs. Forwarded-message replies now tag the forwarder
(`message.from`), not the original author (stored as `forwardedFrom` for audit).

Git and the live VPS should be kept in sync after each deploy from this branch.

## Documentation Baseline

Use these Markdown files as the active continuity baseline:

- `README.md`
- `progress_tracker.md`
- `todo.md`
- `docs/training-and-matching-rules.md`
- `docs/PHONE_GATEWAY_CONTRACT.md`
- `android-gateway/README.md`

---

## Session Handoff (2026-07-04) — Web UI redesign, reskin, deploy

### What shipped (committed `97e691a`, docs `86c86e8`, pushed)

- **Material-3 "ROMER Command Grid" reskin** in `public/theme.css` — token
  *values* remapped (names kept, so every page reskins in place): teal
  interactive accent (`--accent #44e2cd` dark / `#0f766e` light), M3
  surface-container elevation ramp, softer shadows. Dark + light, WCAG AA
  contrast verified. Brand navy preserved for the insignia.
- **Ops page 1a "Deep Command"** (`index.html` + `app.js`): posture ribbon
  with pulsing status badge, gateway fleet as inline-ECG rows, needs-attention
  icon-chip list, sidebar officer-channel card.
- **Admin "Approvals Queue"** (`admin.html` + `admin.js`): the old
  Requests & Replies section restructured into a ROMER master-detail —
  Pending/Resolved/Archived tabs, request cards (elapsed timer + impact badge),
  detail pane with Requested-By / Impact-Analysis / Time-in-Review info cards,
  reply draft, and linked operational signals. Wired to the existing
  approve/reject/retry endpoints unchanged.
- **Bug fix:** Gateway Fleet card overflow (long gateway ids like
  `BANGLALINK_PHONE_01` clipping out of the card) fixed — mono id with
  `overflow-wrap:anywhere`, grid tracks hardened to `minmax(0,1fr)`, plus a
  heartbeat ECG added to each card.

### Deploy + runtime

- `bash scripts/deploy.sh` → VPS `root@45.77.240.195`, both `sms-backend` and
  `sms-bridge` restarted, health 200, files verified on the VPS.
- Admin authorized users: VPS had 4 (source of truth via the admin panel);
  local had 1. Synced local `config/telegram.json` to all 4, restarted
  `sms-bridge` to activate the 2 newest (ASP Ujirpur Circle, ASP Moladi Circle).
  `telegram.json` is gitignored, so the deploy script never overwrites it.

### Planned next — React + Vite frontend migration (`P1`, large, plan approved in principle)

Migrate the vanilla static frontend (`public/`) to a **React + Vite SPA** so
React-native AI design tools (magic MCP, v0, shadcn/ui, Claude Design code
export) can be used directly instead of hand-translated into vanilla CSS/JS.
**Staged:** scaffold + build + verify entirely on **localhost** first; deploy to
the VPS only after a signed-off feature-parity pass; old `public/` kept for
instant rollback. Recommended stack (pending final sign-off): React 18 + Vite +
TypeScript + Tailwind (port `theme.css` teal M3 tokens into the Tailwind theme) +
optional shadcn/ui; new app in `web/`. The **deploy pipeline changes**:
`deploy.sh` gains a `npm run build` step and ships `web/dist/` instead of raw
`public/`; `src/server.js` gains SPA-fallback static serving. Backend logic,
Telegram bridge, Android apps, auth model, and API contracts are **unchanged**.
Phase-by-phase task list with priorities lives in `todo.md` (PLANNED section).
Open decisions before Phase 0: TS+Tailwind vs JS/plain-CSS; shadcn or not;
confirm `web/` location.

### Open follow-ups

- Re-sync Android `colors.xml` (Gateway + Admin apps) to the teal Material-3
  ramp, or decide the apps intentionally diverge (`docs/design-system.md`
  token-parity section flags this). `P2`
- Optional polish: `.status-strip` / `.admin-access` left-accent side-stripes
  and a few em-dashes flagged by the design linter; teal treatment for the
  remaining admin sections (Signals/Audit/Tools); M3 `headline-lg` type scale. `P3`

---

## Session Handoff (2026-06-30) — Phase 1.0 login/MFA backend core

### What was built

Backend foundation for replacing the single shared admin API key with real
per-person accounts:

- `src/userAuth.js` — `UserAuthStore` class, own SQLite file (`data/auth.db`,
  separate from `data/automation.db`). Tables: `auth_users`, `auth_sessions`.
  Password hashing via `node:crypto` scrypt (no bcrypt dependency). Flow:
  `register()` → `verifyEmail(token)` → `startLogin()` (password check, issues
  6-digit MFA code + `pendingToken`) → `completeLogin()` (code check, issues
  8h session token) → `validateSession()` / `logout()`.
- `src/mailer.js` — Gmail SMTP via `nodemailer` (new dependency). Reads
  `GMAIL_USER`/`GMAIL_APP_PASSWORD`/`MAIL_FROM` from `process.env`; logs to
  console instead of sending if unset (keeps `node --test` offline-safe).
- `config/mail.json` (gitignored, same pattern as `config/auth.json` —
  **not** dotenv, to match this repo's existing config convention) holds
  `gmailUser`, `gmailAppPassword`, `superAdminEmail`, `superAdminPassword`.
  `src/config.js` adds `loadMailConfig()` (env vars win over file).
- `src/app.js`: on `createApp()`, `loadMailConfig()` bridges
  `gmailUser`/`gmailAppPassword` into `process.env` for the mailer, and — if
  `superAdminEmail`/`superAdminPassword` are set and no account exists yet for
  that email — auto-creates a verified `super_admin` account (no manual
  registration needed for the founder account, `mdalaulnahid@gmail.com`).
  New routes: `POST /api/auth/register`, `GET /verify-email?token=`,
  `POST /api/auth/login`, `POST /api/auth/mfa/verify`, `POST /api/auth/logout`,
  `GET /api/auth/me`.

### Email infrastructure decided + confirmed working this session

- **Receiving**: `support@opsbarishal.com` → **Cloudflare Email Routing**
  (free, DNS-level, domain is already on Cloudflare) → forwards to
  `opsbarishal@gmail.com`. SendGrid was tried first for this but abandoned —
  phone verification kept failing during signup ("too many attempts").
- **Sending**: backend authenticates as `opsbarishal@gmail.com` via a Gmail
  **app password** (requires 2-Step Verification on that Gmail account first).
  `From:` currently shows `opsbarishal@gmail.com`, not
  `support@opsbarishal.com` — the Gmail "Send mail as" custom-SMTP alias path
  was a dead end (Cloudflare Email Routing has no authenticated outbound SMTP
  relay to point Gmail at). Revisit with a domain-verified sender (SendGrid/
  Resend) later if a `support@` From address is wanted.
- Live smoke test: a real email was sent through `opsbarishal@gmail.com`'s
  app password and confirmed delivered.

### Verified

- `node --test`: **148/148 passing** (was 142; +6 new in `test/userAuth.test.js`).
- `test/security.test.js` and `test/userAuth.test.js`'s `appWith()` helpers
  now explicitly pass `mailConfig: {}` / a nonexistent `SMS_MAIL_CONFIG` path
  — without this, `createApp()` would read the real (gitignored)
  `config/mail.json` during test runs and could trigger live Gmail sends.
  This was caught and fixed before committing.
- `config/mail.json` confirmed gitignored (`.gitignore` updated) — will not
  be committed or pushed.

### Not yet done (see `todo.md`'s Phase 1 entry)

- `config/mail.json` must be created **by hand directly on the VPS** —
  `scripts/deploy.sh` deliberately will not overwrite/create it (same
  bootstrap-once pattern as `config/telegram.json`).
- No login/register HTML pages yet — `/api/auth/*` routes exist but nothing
  in `public/` calls them yet.
- `public/index.html` / `public/admin.html` are not session-gated yet — the
  legacy `adminApiKey` single-key auth (`config/auth.json`) is still what
  actually protects the admin API today.

### Important files

- `src/userAuth.js`, `src/mailer.js`, `src/config.js` (`loadMailConfig`),
  `src/app.js` (new `/api/auth/*` routes + super-admin bootstrap)
- `config/mail.json` (gitignored — exists locally and must be replicated to
  the VPS manually)
- `test/userAuth.test.js` (new), `test/security.test.js` (hardened)
- `scripts/deploy.sh` (added a bootstrap-check echo for `config/mail.json`,
  same shape as the existing `config/telegram.json` check)

---

## Session Handoff (2026-06-29) — diagnosed retried-request reply auto-matching bug

### What was diagnosed

**Incident:** REQ-20260629-0694-28U1 (MS-NID 01846234464 to ROBI):
- Request timed out at 15:45, TIMEOUT posted to Telegram
- User manually retried request
- Operator replied (MSISDN 8801846234464, NID 4667103669, DoB 10/17/2004)
- ✅ Reply received and stored in unmatched SMS inbox
- ❌ Auto-matcher failed to link it to the original request
- ❌ Reply never posted to Telegram (requires manual matching in admin dashboard)

**Root cause:** When `retryRequest()` is called, request status is set to `QUEUED`, then dispatched.
`findActiveRequestForGateway()` only checks `WAITING_OPERATOR_REPLY`, `NEEDS_MANUAL_REVIEW`, and `TIMEOUT` (within 1 hour).
If the request transitions to a non-matchable status before the operator's late reply arrives, the auto-matcher won't find it.

**Workaround (immediate):** Manually match the reply in admin dashboard via `rankReplyCandidates()` + `correctMatch()`.

**Fix (required):** Extend reply window for retried requests (currently 1h for TIMEOUT, should be 2h for retried). See `todo.md` for details.

### Important files

- `src/service.js` — `retryRequest()` function at line ~545
- `src/store.js` — `findActiveRequestForGateway()` function (reply window logic)
- `todo.md` — comprehensive bug write-up with fix checklist

### Verified

- Both bridge and backend processes running correctly
- Reply matching system works for direct (non-retried) timed-out requests
- Manual correction workflow (`rankReplyCandidates` + `correctMatch`) successfully re-matches orphaned replies

---

## Session Handoff (2026-06-23) — open group auth + forward-aware tagging

### What changed

1. **Group chat is now open regardless of `authorizedUsers`** — the
   `authorizedUsers` whitelist in `config/telegram.json` previously gated both
   private DMs and group submissions. Adding even one entry (needed for DM
   access) closed the group to all non-whitelisted members. Officers forwarding
   requests from colleagues were silently rejected (`shouldSuppressGroupReply`
   suppressed the auth error). Fixed: `planIntake()` in `bridge.js` no longer
   checks `authorizedUsers` for group-chat messages — any group member can
   submit. Private DM authorization is unchanged.

2. **Forwarded message tagging** — `planIntake()` now detects `forward_from` /
   `forward_sender_name` on incoming messages and stores the original author as
   `forwardedFrom` metadata on the request. The reply always tags `message.from`
   (the group member who forwarded), never the original author. Log line now
   includes `[fwd from: X]` for forwarded messages.

3. **Recovered 3 silently rejected requests** — manually resubmitted via the
   backend API:
   - `REQ-20260622-0285-MPLU`: `IMEI-MS` with 4 IMEIs (originally from SI Nazmul Bakerganj, forwarded by Bakerganj Circle)
   - `REQ-20260622-0286-V7IQ`: `LCL 01726956407`
   - `REQ-20260622-0287-I12L`: `LRL 01726956407`

### Important files

- `telegram-bridge/bridge.js` — `planIntake()` group auth removed, `forwardedFrom` metadata added
- `test/telegramBridge.test.js` — 19 tests (was 17), new tests for forwarded message tagging

### Test results

19 bridge tests pass. Full suite not re-run (only `bridge.js` changed).

### Deployed

- `bridge.js` deployed via `scp` + `pm2 restart sms-bridge`
- Backend unchanged this session

---

## Session Handoff (2026-06-20 night) — reply-type misclassification incident

### What happened

A requester sent `LRL 01718589986` via private Telegram DM. An unrelated GP reply
("Sorry No records found for IMEI: 353917104327090 [GP]") arrived first and was
auto-matched to the LRL request, which was then approved and posted — wrong
answer delivered. Two minutes later the real LRL reply (with full location data)
arrived, found nothing left to attach to, and was silently dropped as unmatched.

### Root cause

`replyAnalyzer.js`'s strong-type detection regexes for IMEI/NID replies were
line-anchored (`(?:^|\n)\s*imei[:\s]`), so they never matched GP's actual "no
records found" template, which embeds the keyword mid-sentence. The reply
scored as type-neutral, and the single-pending-request fallback (payload-blind
by design) accepted it since it was the only open request on that gateway.

### Fix (deployed, tested)

- `src/replyAnalyzer.js`: added unanchored fallback patterns for IMEI/NID
  "no records found" replies so they're correctly type-tagged regardless of
  position in the message.
- `src/service.js`: added `rankReplyCandidates(inboxId)` (ranks every plausible
  request — including already-`COMPLETED` ones — using the same scoring as
  live auto-matching) and `correctMatch(inboxId, requestId)` (re-attaches an
  orphaned reply to the correct request, detaches any wrongly-matched inbox
  row for that request/gateway, and issues a new `⚠️ Correction —` reply draft
  instead of silently rewriting history).
- `src/app.js`: `GET /api/admin/unmatched/:id/candidates`,
  `POST /api/admin/correct-match` (both admin-gated).
- `public/admin.js`: the unmatched-SMS panel's manual-match dropdown now shows
  ranked candidates with scores (including completed ones, labeled "correction")
  instead of a flat unranked list.
- `test/replyMatching.test.js` (new, 5 tests): regression test reproducing the
  exact GP message, plus coverage for `rankReplyCandidates`/`correctMatch`.
- Tonight's actual stuck production request (`REQ-20260620-0118-D5UQ`) was
  corrected live via the new endpoint — the real LRL answer was posted to the
  requester's private chat with a correction note.

### Verified

- `node --test` across all 8 test files: 138/138 passing (was 133 before this
  session; +5 new in `test/replyMatching.test.js`).
- Deployed via `bash scripts/deploy.sh`; confirmed `pm2 status` online for both
  `sms-backend` and `sms-bridge`.
- Confirmed via the dashboard API that the correction reply draft reached
  `sentStatus: POSTED_LIVE` with a real `postedMessageId`.

---

## Session Handoff (2026-06-20)

### What changed

Reply matching and safety:

- wrong-request reply attachment was hardened in backend correlation logic
- family confusion such as `LRL` vs `LCL` and `MS-NID` vs `IMEI-MS` is handled more cautiously
- ambiguous replies now fall to review more readily instead of forcing an auto-match
- authorization-style failure messages are no longer posted back into the shared Telegram group
- watchdog unauthorized-send alerts no longer fall back into the group chat

Training-data strategy:

- the five curated workbooks in `Training Data/Automation/` are now the active manual baseline
- runtime matching uses generated cache files in `data/training-cache/`
- old single-file `data/reply-patterns.json` is no longer the runtime source
- automatic self-training into the curated baseline is disabled
- review-only examples can be stored separately in `data/manual-review/` with a cap of 100 entries per request type

Android inbound retry:

- retries now preserve original `gatewayId`
- full inbound SMS body is retained
- original receive timestamp is retained
- Android sends a deterministic `deliveryKey`
- backend deduplicates repeated inbound webhook retries

### Current test status

Verified in this session:

- `node --test test\workflow.test.js test\telegramBridge.test.js test\trainingData.test.js test\manualReviewStore.test.js`
- result: `95/95` passing
- Android build: `android-gateway\gradlew.bat :app:assembleDebug`
- result: build successful when `JAVA_HOME` points to `C:\Program Files\Android\Android Studio\jbr`

### Important files from this hardening pass

- `src/parser.js`
- `src/replyAnalyzer.js`
- `src/service.js`
- `src/store.js`
- `src/trainingData.js`
- `src/manualReviewStore.js`
- `telegram-bridge/bridge.js`
- `android-gateway/app/src/main/java/com/smsgateway/SmsReceiver.kt`
- `android-gateway/app/src/main/java/com/smsgateway/WebhookSender.kt`
- `android-gateway/app/src/main/java/com/smsgateway/RetryWorker.kt`
- `android-gateway/app/src/main/java/com/smsgateway/db/AppDatabase.kt`

### Current caution

- Android lint may still fail on this workstation if Google Maven SSL trust is broken locally
- the deploy script must include newer backend support files such as training-cache/manual-review logic
- remaining non-critical review follow-ups still include `src/app.js` audit-call cleanup and Telegram offset cold-start resilience

---

## Environment

| Component | Location | Notes |
|-----------|----------|-------|
| Backend | `45.77.240.195:3000` | Vultr Singapore VPS |
| Public host | `https://licbarishal.duckdns.org` | Admin API reachable here — **planned migration to `opsbarishal.com`, see `docs/domain-migration-plan.md`** |
| Android JDK | `C:\Program Files\Android\Android Studio\jbr` | verified for local build |

---

## Next Recommended Steps

1. Keep curated workbook examples up to date in `Training Data/Automation/`
2. Review `data/manual-review/*.json` periodically before promoting any examples into curated workbooks
3. Continue with the remaining backend review issues after deploy
