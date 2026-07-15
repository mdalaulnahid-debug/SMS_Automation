# Security Hardening V1 — Implementation Status (branch-local)

**Branch:** `feature/security-hardening-v1` (isolated from `main`/production —
see this branch's `docs/security-hardening-v1-design.md` for the full locked
design this tracks progress against). This file is branch-local — it
documents in-progress WIP state, folded into `progress_tracker.md`/`todo.md`
at merge time, not before.

**How to pick this back up:** `git checkout feature/security-hardening-v1 &&
git pull`, read this file, then the design doc, then `git log main..HEAD`
for what's actually landed. Everything built/tested on **localhost only** —
never run `scripts/deploy.sh` on this branch.

**⚠️ 2026-07-15: confirmed this branch is 40 commits ahead of `main` and has
never been merged.** Production is still running pre-hardening code — this
was discovered while fixing an unrelated production bug report (production's
`register.html` is missing fields that were added in commit `822e494`, step
5). The full merge + deploy is a real decision the user needs to make
explicitly (registry-gated registration is a behavior change, not just a
bugfix) — tracked as a `P1` CRITICAL item in `todo.md`.

## Status by component (per design doc §14 build order)

| # | Component | Status |
|---|---|---|
| 1 | Unit tests in isolation: registry-match, quota logic, OTP generation/expiry/attempts | **Done** (24 tests, `src/personnelRegistry.js`, `src/quota.js`, `src/otp.js`) |
| 2 | Server-side page gating (4-tier) | **Done** for `/` and `/admin` (see scoping note below) |
| 3 | `telegramId` + identity unification | **Done** (schema migration + link/lookup methods; bridge cutover deferred, see note below) |
| 4 | Personnel Registry data model + admin-upload loading | **Done** |
| 5 | Registration flow end-to-end | **Done** for the web + bridge-link mechanics (see scoping note below — closing the group-chat "always open" policy itself is deliberately deferred) |
| 6 | Quota + email-OTP re-verification middleware | **Done** |
| 7 | Admin group actions (post-bypass + moderation) | **Done** (code complete; moderation commands untested against a real Telegram group — bot must be promoted to group admin first, see note below) |
| 8 | Shared admin key scoping/retirement | **Done** (partial by design — see scoping note: Android apps have no session-login flow, so key access was preserved everywhere they call) |
| 9 | Behavioral anomaly tripwire | **Done** |
| 10 | Local end-to-end simulation | **Done** |

## Latest update

**2026-07-07** — Branch created off `main` (`fbf9570`). Design fully locked
during multi-round review/interview (server-side-only access gap,
Telegram's no-IP/device limitation, identity unification, registry
validation, migration window, approval-policy split).

**Step 1 complete.** Three pure, dependency-injected (fake-clock testable)
modules built and fully unit-tested before any server wiring:
- `src/personnelRegistry.js` — `PersonnelRegistry.matchByPhoneAndEmail()`.
  Critical property tested explicitly: phone matching one record + email
  matching a *different* record must never pass.
- `src/quota.js` — `QuotaTracker`, count-or-time-window whichever trips
  first, per-officer isolation, `resetAfterVerification()`.
- `src/otp.js` — `OtpStore`, crypto-secure 6-digit codes, expiry, bounded
  verify attempts, per-hour issuance throttle (so the challenge itself
  can't spam an officer's inbox), single-use (consumed on success/expiry/
  lockout).
24 new tests, full suite 185/185 passing (161 pre-existing + 24 new).
Next: Step 2, server-side page gating.

**Step 2 complete.** Found and fixed a real architectural blocker before
writing the gate itself: this app's session transport is *entirely*
localStorage + custom-header based (`Authorization`/`x-api-key`), and a
plain browser page navigation never carries either — only cookies. So
"check the session server-side before serving `/admin`" was literally
impossible with the existing transport; it would always see an
unauthenticated request even for a legitimately logged-in user. Fixed by
adding a minimal cookie layer (`src/cookies.js`) purely for page-level
auth, wired into login (sets an HttpOnly/SameSite=Lax cookie alongside the
existing JSON token response) and logout (clears it) — the existing
header-based API auth for `fetch()`/XHR calls is completely untouched.

`guardPage(req, res, allowedRoles)` in `app.js` now gates `GET /` (any of
officer/admin/super_admin) and `GET /admin` (admin/super_admin only),
redirecting to `/login.html` if unauthenticated or `/` if authenticated
with an insufficient role — real HTTP redirects, not just a client-side JS
hide. Verified two ways: 19 new automated tests (10 for the cookie module,
9 integration tests hitting the real app through the full register→verify→
login→mfa flow), and a live manual pass against the running local server —
confirmed unauthenticated redirect, officer unlocking `/` but bounced from
`/admin`, admin unlocking `/admin`, and logout actually revoking page
access afterward. Full suite: 204/204 passing.

**Deliberate scoping note:** this step is the *enforcement mechanism*
only. It does not yet change *what* `/` shows content-wise (still the full
ops dashboard, same as before) — collapsing that down to the minimal
informational page for the Registered Officer tier is separate content
work, not done here, flagged in the design doc §4 as likely worth doing
alongside the eventual frontend migration rather than twice.
`/admin.js`/`/app.js` (the raw JS files) are intentionally NOT gated —
gating the HTML entry point is what matters; the JS files being fetchable
by direct URL only reveals client-side code structure, not data, and is
the same residual every website with public JS bundles accepts.

The legacy shared admin API key does **not** work for page routes at all —
not by removing it, but because a browser navigation has no way to attach
a custom header in the first place. Confirmed by test. This is a natural
nudge toward the step-8 key retirement, not something built specially here.

**Step 3 complete.** `telegram_id` added to `auth_users`:
- Fresh installs get it directly in `CREATE TABLE`; existing DB files get a
  runtime migration (`_migrateSchema()` in the `UserAuthStore` constructor —
  `ALTER TABLE ADD COLUMN` if missing) since `CREATE TABLE IF NOT EXISTS` is
  a no-op against a table that already exists. Verified against a
  synthetically-built old-shape DB (unit test) **and** live against the
  real local `data/auth.db` file — pre-existing row preserved, column now
  present.
- A partial `UNIQUE` index (`WHERE telegram_id IS NOT NULL`) enforces one
  Telegram identity → at most one account, while allowing any number of
  not-yet-linked (NULL) accounts.
- New `UserAuthStore` methods: `getUserByTelegramId()`, `linkTelegramId()`
  (rejects if the ID is already claimed by a different account; re-linking
  the same ID to the same account is a harmless no-op), and `register()`
  gained an optional `telegramId` parameter for the future bot-driven
  registration link flow to plug into.
- 8 new tests, full suite 212/212 passing.

**Deliberate scoping note:** this step only builds the *linking mechanism*.
The Telegram bridge's `planIntake()` still reads `config/telegram.json`'s
flat `authorizedUsers` map — it does **not** yet check `auth_users` by
`telegram_id`. Flipping that over now, before any real registration flow
exists to populate the column, would lock out every current Telegram user
at once. That cutover belongs with Step 5 (registration flow), once
accounts can actually acquire a `telegram_id`.

**Step 4 complete.** Personnel Registry now has real persistence and an
admin-upload path:
- `personnel_registry` table added to `auth.db` (fresh table, no migration
  needed — `CREATE TABLE IF NOT EXISTS` is sufficient unlike step 3's
  `telegram_id`).
- `src/personnelRegistry.js` gained `parseRegistryWorkbook(buffer)`,
  reusing the same `xlsx` package `trainingData.js` already uses for the
  same admin-provided-workbook pattern — no new import format invented.
  Case-insensitive column aliasing (e.g. "Full Name"/"Mobile" both work),
  Name/Phone/Email required, Designation/Unit optional, blank/incomplete
  rows skipped.
- `UserAuthStore` gained `replaceRegistry()` (wholesale replace in a
  transaction — a re-import supersedes the roster, doesn't merge with it;
  rolls back cleanly on a bad record), `listRegistry()`, `registrySize()`,
  and `buildPersonnelRegistry()` (returns a ready-to-use matcher from
  step 1's pure `PersonnelRegistry` class).
- Two admin-auth-gated endpoints: `POST /api/admin/personnel-registry/import`
  (accepts the raw `.xlsx` bytes directly as the POST body — `fetch()` can
  send a File/Blob that way, so **no multipart parsing was needed** despite
  the earlier-flagged "zero file-upload precedent" gap) and
  `GET /api/admin/personnel-registry` (list + count).
- 17 new tests (7 workbook parsing, 5 store persistence, 5 HTTP
  integration) — full suite 229/229. Also verified live: real HTTP import
  + list against the running local server, confirmed 401 without auth,
  confirmed a bad workbook 400s without touching a previously-imported
  registry. Test data cleaned from the local dev DB afterward.

**Note for step 5:** the registry data itself (real personnel) hasn't been
provided yet — the user said they'll supply it later. The loader/endpoints
are ready and tested with synthetic data; nothing here depends on having
the real roster to proceed with step 5's registration flow, but the real
import should happen before step 5 goes live end-to-end.

**Step 5, part 1 — activation policy + super-admin approval — done.**
- `config/auth.json` gained `registrationWindowEndsAt` (ISO timestamp).
  Default (unset) means "always auto-activate" — deliberately backward
  compatible, never changes behavior for a deployment that hasn't opted
  into the rollout yet.
- `isWithinRegistrationWindow()` (pure, testable) is the single policy
  decision point: `verifyEmail()` now lands an account on `active`
  (window open / not configured) or the new `pending_approval` status
  (window closed). `pending_approval` accounts are blocked from logging
  in with a clear message, and `validateSession` blocks them too as
  defense in depth.
- New `requireSuperAdmin` (stricter than `requireAdmin` — role must
  specifically be `super_admin`) gates 4 new endpoints:
  `GET/POST /api/admin/settings/registration-window` (view/set the
  window, applies immediately without restart, same pattern as the
  existing `/setup` admin-key write) and
  `GET /api/admin/registrations/pending` +
  `POST /api/admin/registrations/approve` (the approval queue).
- 26 new tests (9 pure policy logic, 3 settingsStore persistence, 5+ HTTP
  integration covering the super_admin-vs-admin distinction specifically)
  — full suite 246/246. Verified live against the running local server
  too (401 unauthenticated, 200 with the legacy key, clean startup).

**Step 5, part 2 — registration-link token + registry-validated registration
+ bridge link mechanics — done.**
- `auth_users` gained `designation`/`unit` columns (same runtime-migration
  pattern as step 3's `telegram_id`) — captured at registration time and
  stored as submitted, alongside (not replacing) the phone+email match
  against the Personnel Registry.
- New `registration_tokens` table + `UserAuthStore.createRegistrationToken()`
  / `consumeRegistrationToken()`: one active token per Telegram ID (a repeat
  request re-issues rather than accumulating rows), 24h expiry, single-use
  (burned on successful consumption).
- `POST /api/telegram/registration-link` (admin-gated, same as the bridge's
  existing reporting endpoints) mints a token for a given `telegramId` and
  returns a full `register.html?token=...` URL.
- `POST /api/auth/register` now **requires** the submitted phone+email to
  match the SAME Personnel Registry record — "no registry match, no
  account" is enforced from this point on, not just validated in isolation.
  This is a real behavior change: **an admin must import the registry
  before anyone can register**, including on this local dev server (its
  registry is currently empty — confirmed live: a real registration attempt
  against it now correctly 400s). If a `registrationToken` is also
  submitted, it's consumed to link `telegramId` on the new account;
  an invalid/expired/reused token 400s even when phone+email match.
- `telegram-bridge/bridge.js`'s `handleIntake()`: a first-time unauthorized
  *private* DM now gets a reply with the registration link (fetched via the
  new `backendClient.requestRegistrationLink()`, best-effort — no link if
  the backend call fails), deduped alongside the existing
  unauthorized-attempt audit report so a retried DM doesn't re-spam the
  link. Group-chat behavior is untouched.
- `public/register.html` gained Designation, Unit, and Phone fields, and
  now reads a `?token=` query param and threads it through as
  `registrationToken` in the POST body when present.
- 22 new tests (6 token lifecycle, 5 HTTP registration/link-endpoint
  integration, 3 bridge-reply behavior, plus fixes to 3 existing test
  files' registration helpers to seed a matching registry record — full
  suite **261/261**. Live-verified against the running local server:
  `register.html` serves the new fields and token-handling script,
  `/api/telegram/registration-link` 401s unauthenticated, and a
  registration attempt against the (currently empty) real registry
  correctly 400s and leaves no row in `data/auth.db`.

**Deliberate scoping note — what step 5 does NOT include:** the Telegram
bridge's group-chat policy is still fully open (any group member can
submit, per `planIntake()`'s existing "group allowlist only gates private
DMs" comment) — closing that to "registered `telegram_id` only" needs real
registry data loaded first (today's registry is empty on both this dev
server and, presumably, production) and a rollout plan for existing group
members who haven't registered yet, which is a policy decision for the
user to make once real personnel data is available, not something to flip
silently in this pass. The registration-link mechanism above only fires
for *private* DMs, which is where the design doc's "new user requests" flow
was scoped from the start.

**Admin-console Personnel Registry UI (2026-07-08) — done.** Requested by
the user after realizing the console had no upload button, only the step-4
backend endpoints. Added to `public/admin.html`'s Controlled Tools grid:
- A file-picker + **Import spreadsheet** button (any admin/super_admin) —
  reads the chosen `.xlsx` as an `ArrayBuffer` and POSTs it raw to the
  existing `/api/admin/personnel-registry/import` endpoint, same wholesale-
  replace semantics as before, now reachable without a script.
- An **Add to registry** single-record form (super_admin only — the user
  explicitly asked for this to be a stricter tier than the bulk import),
  wired to a new endpoint: `POST /api/admin/personnel-registry/add`
  (`requireSuperAdmin`, new `UserAuthStore.addRegistryRecord()` — adds one
  row without touching the rest of the roster, rejects an exact
  (phone, email) duplicate rather than silently double-adding).
- A live-refreshing list of current registry records beneath both forms.
- `public/shared.js` gained `isSuperAdminUnlocked()` (mirrors
  `isAdminUnlocked()` but role must specifically be `super_admin`,
  legacy key still satisfies it) to gate the add-form's visibility client-side
  — the real enforcement is server-side via `requireSuperAdmin`, this only
  hides a control a plain admin couldn't use anyway.
- 8 new tests (3 store-level, 5 HTTP integration including the
  super_admin-vs-admin distinction) — full suite **269/269**. Live-verified
  through the actual running admin console UI (not just API calls): logged
  in as the real local super_admin account (a temporary session row,
  cleaned up after), confirmed the registry list renders all 22 real
  records, filled and submitted the add-officer form end-to-end (record
  appeared, count went 22→23), confirmed a plain `admin`-role session does
  NOT see the add-form (`isSuperAdminUnlocked()` false), then removed the
  test record and session from `data/auth.db`.

**Note:** `/admin` has a client-side "if narrower than 900px, redirect to
`/`" guard from earlier UI work — irrelevant day-to-day (real browsers are
wide enough) but easy to trip during automated testing at a mobile-preset
viewport width.

**Public landing page content (2026-07-08) — done.** Completes the content
half of Step 2's access-tier boundary (the enforcement mechanism landed
back then; what `/` actually *shows* per tier didn't). `public/index.html`'s
Home tab now branches on role: `officer` sessions get an informational
view (purpose statement + a real account status card — name, designation,
unit, email, phone, registration status, Telegram-link state) with the
Activity tab and gateway/KPI content hidden entirely; `admin`/`super_admin`
see the operational dashboard unchanged. Enforced both client- and
server-side: `/api/ops/overview`, `/api/ops/activity`, `/api/ops/gateways`
tightened from `requireAnySession` to `requireAdmin`, so the boundary
holds even against a direct API call, not just what the page renders.
Also fixed a real pre-existing leak surfaced while wiring the account
card: `GET /api/auth/me` was returning the *entire* `auth_users` row —
including `password_hash`, `verify_token`, `mfa_code_hash`,
`pending_session_token` — to any logged-in client; added `safeUserFields()`
as an explicit allowlist. Also created `PRODUCT.md` (impeccable init) for
this project. 2 new tests, full suite 270/270 at the time, live-verified
with real officer/super-admin sessions (no `/api/ops/*` calls fire for the
officer tier — important, since a stray call would have 401'd and
triggered the client's `sessionLogout()` handler, silently signing the
officer out just for opening the home page).

**Step 6 — quota + email-OTP re-verification middleware — done.** Wires
the Step-1 pure modules (`src/quota.js`'s `QuotaTracker`, `src/otp.js`'s
`OtpStore`) into the actual request path, per design doc §7:
- `POST /api/requests` now resolves `requesterId` (the Telegram sender ID)
  to a linked officer account via `getUserByTelegramId()`. Unlinked
  senders (unregistered, or non-Telegram channels) are never quota-gated —
  this defense only applies once an identity is actually registry-verified
  and linked. A linked officer's quota trips per `QuotaTracker` (default
  20 requests / 4h, whichever first); on breach, `OtpStore.issueCode()`
  mints a 6-digit code, emailed to the officer's **registry-verified**
  address via a new `mailer.reVerificationCodeEmail()`, and the request is
  rejected with `errorCode: 'VERIFICATION_REQUIRED'`. A second breach
  while a challenge is already pending is blocked without re-issuing
  (checked via `OtpStore.hasActiveChallenge()`, new method).
- New `POST /api/telegram/verify-code` (admin-key gated, same pattern as
  the bridge's other reporting endpoints): resolves the officer, calls
  `otpStore.verifyCode()`, and on success calls
  `quotaTracker.resetAfterVerification()` — reopening the window. Both
  outcomes are audit-logged (`TELEGRAM_QUOTA_BREACH`,
  `TELEGRAM_OTP_VERIFIED`, `TELEGRAM_OTP_FAILED`).
- Bridge side (`telegram-bridge/bridge.js`): a bare 6-digit **private DM**
  from an *already-authorized* sender is now parsed as an OTP reply
  (`planIntake` gains an `otp_verify` action) rather than a malformed
  request — no real request command is ever shaped like a standalone
  6-digit number, so this is unambiguous. `handleIntake` calls the new
  `backendClient.verifyOtpCode()` and relays a specific reply per outcome
  (verified / no active challenge / expired / incorrect / attempts
  exceeded). Group messages and unauthorized senders are never treated as
  OTP replies — authorization still gates first.
- `QuotaTracker`/`OtpStore` are per-process, in-memory (injectable via
  `createApp({ quotaTracker, otpStore })` for tests) — a backend restart
  clears everyone's quota/challenge state, acceptable for a defense whose
  job is slowing an in-progress impersonation attempt, not maintaining a
  long-lived ledger.
- 12 new tests (2 pure-logic, 5 HTTP wiring integration, 5 bridge
  plan/handle) — full suite **281/281**. Live-verified against the running
  local server for everything that doesn't risk a real email send (this
  dev machine's `config/mail.json` has real Gmail credentials): confirmed
  `POST /api/telegram/verify-code` 401s unauthenticated and returns
  `NO_ACTIVE_CHALLENGE` for an unlinked ID with the real admin key, and
  confirmed a normal request from a non-linked `requesterId` still submits
  successfully (unaffected by the new gate). The actual quota-breach →
  email → verify → reset cycle is covered by the automated test suite
  instead (SMTP-not-configured path in tests logs instead of sending), not
  re-run live, to avoid triggering a real Gmail send during verification.

**Note for step 7+:** quota/OTP state is in-memory only — if the backend
process restarts mid-challenge, the officer's pending code is silently
lost (they'd need to trip the quota again to get a new one). Acceptable
for V1 per the design doc's scoping; worth a persisted-state pass later if
backend restarts become frequent in production.

**Step 7 — admin group actions — done (design doc §9).**
- **Post-any-message bypass:** `AutomationService` gained an optional
  `isAdminTelegramSender(telegramId)` predicate (injected from `app.js`,
  which owns `userAuth` — kept out of `service.js` to avoid entangling the
  core automation engine with the auth subsystem). When a Telegram group
  message fails command parsing AND the sender resolves to a linked,
  active `admin`/`super_admin` account, `submitRequest()` returns
  `errorCode: 'ADMIN_POST_BYPASS'` (audited as `TELEGRAM_ADMIN_POST`,
  distinct from a real `REQUEST_VALIDATION_FAILED`) instead of the normal
  rejection — the bridge suppresses any reply (added to
  `shouldSuppressGroupReply`'s set), so an admin's announcement in the
  group is never flagged as an "unsupported command". A **valid** command
  from an admin is still processed completely normally — the bypass only
  fires on parse failure, so admins keep full officer capability too.
- **Moderation:** `/ban`, `/mute [minutes]`, `/unmute` (as a reply to the
  target's message — the standard Telegram-mod-bot UX, since usernames
  aren't reliably resolvable to user IDs via the Bot API without already
  being cached) and `/unban <numericId>` (explicit ID, since a banned user
  can't be replied to). `planIntake()` only detects command *shape*;
  authorization is checked **fresh on every attempt** against a new
  `POST /api/telegram/moderation-check` (admin-key gated, resolves the
  actor's Telegram ID via `getUserByTelegramId` and checks
  role+active-status) — no caching/polling in the bridge, so a role change
  or account disablement takes effect on the very next command, not after
  some refresh interval. `TelegramClient` gained
  `banChatMember`/`unbanChatMember`/`restrictChatMember` (mute reuses
  `restrictChatMember` with all permissions false, an optional
  `until_date` for a timed mute). Every attempt — success or failure — is
  reported to a new `POST /api/telegram/moderation-action` (audit-only;
  this backend holds no bot token and cannot moderate directly, only the
  bridge process can) and audited as `TELEGRAM_MODERATION_ACTION`.
- **Explicit failure surfacing for the stated prerequisite:** the design
  doc calls out that the bot must be promoted to group admin with
  ban/restrict rights before this can function at all. Rather than let
  that fail as a raw Telegram API error, a `CHAT_ADMIN_REQUIRED` catch
  replies with a plain-language explanation
  ("the bot is not a group admin with the required rights") both in-chat
  and in the audit report.
- 19 new tests (3 service-level for the post-bypass, 5 HTTP integration
  for the two new endpoints, 11 bridge plan/handle for moderation parsing
  and execution) — full suite **298/298**. Live-verified the two new
  backend endpoints against the running local server (401 unauthenticated,
  `authorized: false` for an unlinked ID, a reported action audits
  correctly) — the actual Telegram-side moderation calls
  (`banChatMember` etc.) were **not** exercised against a real group,
  since that requires the operational prerequisite (bot promoted to group
  admin) which has not been done yet; that path is covered by the
  automated tests' fake `telegram` client instead, including the
  `CHAT_ADMIN_REQUIRED` failure path.

**Operational prerequisite — confirmed satisfied (2026-07-08).** The user
promoted the bot to group admin. Verified with a read-only
`getChatMember` call against the bot's own membership in the real group
(no moderation action performed, nothing touched): `status: administrator`,
`can_restrict_members: true`, `can_delete_messages: true`. `/ban`/`/mute`/
`/unban` should now work for real, not just against the test suite's fake
Telegram client — not yet exercised against a real group member, since
that's a visible, hard-to-reverse action in a live operations channel and
needs the user's go-ahead on a safe target first. User declined live
testing for now — trusting the automated suite + the read-only rights
confirmation above.

**Step 8 — shared admin key scoping/retirement — done, deliberately
partial (design doc §10).**
- **Real blocker found before writing any code, changed the plan:** grepped
  every actual caller of the shared `adminApiKey` across the codebase
  (`android-gateway/*/src`, `telegram-bridge/`, `public/`) rather than
  assuming. Found the **Android Admin App** (`android-gateway/adminapp` —
  a native mobile-supervisor console, human-facing) authenticates *purely*
  via the shared key (`x-api-key` header, see `AdminBackendClient.java`)
  with **no session-login flow of its own** — same for the Android Gateway
  App's own machine calls. Retiring the key from every human-reachable
  endpoint as the design doc's literal text suggests would have broken a
  real, currently-working tool with no replacement auth path (building one
  means adding native-app login, far outside this step's scope). Surfaced
  this to the user before touching any code; user's answer: **don't touch
  the apps.**
- **Scoped retirement instead of a blanket one.** Enumerated every endpoint
  either Android app calls (dashboard, admin overview/requests/replies/
  unmatched/audit, admin settings + sub-routes, reply-drafts including
  `.../approve`, requests reject/retry, every `/api/gateway/*` +
  `/api/admin/gateways/*`) — those keep accepting the shared key exactly as
  before, `requireAdmin`/`requireSuperAdmin` untouched. Two new, stricter
  helpers apply only where zero Android dependency was confirmed:
  - `requireAdminSessionOnly` / `requireSuperAdminSessionOnly` — session
    required, key rejected outright. Applied to: QR provisioning,
    Personnel Registry (list/import/add), registration approval queue,
    registration-window settings, rejected-messages, `/api/users*`,
    audit verify/export, manual-match + unmatched-candidates +
    correct-match, `/api/sms/unmatched`, `/api/timeouts/run`, and the
    `/api/ops/*` trio from step "public landing page" (all either brand
    new to this security-hardening initiative, or pre-existing
    admin.html-only tools admin.html already reaches via real session
    login — nothing human actually loses access).
  - `requireMachine` — the Telegram bridge's own reporting/moderation
    endpoints (`chat-mismatch`, `unauthorized-attempt`,
    `registration-link`, `verify-code`, `moderation-check`,
    `moderation-action`): key-only, same check as before under an honest
    name — no human ever called these directly, so this is a real
    hardening (a compromised session token literally cannot invoke them
    anymore) with zero behavior change for the bridge.
  - Also deleted `requireAnySession` (dead code — nothing called it since
    the `/api/ops/*` tightening in the earlier "public landing page" work).
- 0 new endpoints, so no new test *file* — but 8 existing tests broke as
  intended (they relied on the key working where it now doesn't) and were
  updated to create a real session instead, across
  `test/personnelRegistryEndpoint.test.js` and `test/security.test.js`
  (which also gained an `authDbPath: ':memory:'` + `createAdminSession()`
  helper, previously absent). Full suite **298/298** (net zero new tests —
  same count as step 7, since this step only reclassified auth on existing
  endpoints).
- **Live-verified the exact boundary**, not just the test suite: against
  the real running server with the real admin key —
  `/api/admin/overview` and `/api/dashboard` (Android-dependent) still
  **200**; `/api/audit/export` and `/api/ops/activity` (retired) now
  **401**; `/api/telegram/moderation-check` (machine-only) still **200**.
  Then confirmed a real super_admin session (temporary row, cleaned up
  after) reaches both retired endpoints successfully — the replacement
  path actually works, not just "the old path is blocked".

**Deliberately NOT done — explicit scope boundary, not an oversight:**
building a session-login flow for the Android Admin/Gateway apps, which
would let the key be retired from `/api/admin/overview`, `/api/dashboard`,
`/api/admin/settings*`, reply-drafts, requests reject/retry, and every
`/api/gateway/*`/`/api/admin/gateways/*` endpoint too. That's genuinely
out of scope for a backend security-hardening pass — it's an Android app
feature (login screen, token storage, refresh handling) — and was
explicitly declined by the user for this round. Revisit if/when the
Android apps get their own auth overhaul.

**Step 9 — behavioral anomaly tripwire — done (design doc §11).** A soft
net underneath the hard quota/OTP wall from step 6 — flags surface to
admins as review items, never blocks a request.
- New pure module `src/anomalyDetector.js`'s `AnomalyDetector` (same
  injectable-clock, per-process, per-officer-profile pattern as
  `QuotaTracker`/`OtpStore`), tracking four signals per linked officer:
  - **Off-hours submission** — outside 06:00-22:00 **Bangladesh Standard
    Time** (fixed UTC+6 offset computed directly, not the server's local
    timezone — correct here since every real-world officer is in one
    timezone, not a simplification to revisit).
  - **Burst volume** — more than 8 requests within 5 minutes, a
    deliberately *softer, earlier* warning than the hard quota (20/4h) —
    catches a suspicious pace well before the quota wall would ever
    trigger.
  - **Identity drift** — Telegram's `language_code`/`username` changing
    from what was last seen for that officer (no flag on the very first
    sighting — needs a baseline to drift *from*).
  - **Request-type pattern shift** — flagged only once real history exists
    (≥5 prior typed requests) and one type has clearly dominated (≥70%) —
    an evenly-mixed history never trips this, and an unparsed/garbled
    message never counts toward or against it.
- Wired into `POST /api/requests` (`checkBehavioralAnomaly()` in
  `src/app.js`): runs for every linked-officer Telegram submission
  attempt, **including ones the quota wall already blocked** — a
  quota-blocked burst is itself a meaningful timing/volume signal, worth
  flagging even though no `requestType` exists for it. Every flag is
  audit-logged as `BEHAVIORAL_ANOMALY_FLAGGED` (actor = officer's email,
  details = flag type + human-readable detail) — the request's actual
  response (`201`/`400`) is completely unaffected either way, honoring
  "flags, not blocks" from the design doc.
- `telegram-bridge/bridge.js`'s `planIntake()` now forwards
  `message.from.language_code`/`.username` in the request payload it
  submits — metadata Telegram already sends on every message, no new Bot
  API capability needed, matching the design doc's framing.
- Surfaced to admins the same way every other Telegram signal already is
  (`buildAdminData()` in `src/app.js`): `stats.behavioralAnomalies24h`
  (rolling 24h count) + `diagnostics.recentAnomalyFlags` (detail array) on
  `GET /api/admin/overview` — deliberately **not** added to
  `summarizeAlerts()`'s alert count, since these are explicitly
  non-blocking review items, not "needs action" alerts like pending
  approvals or offline gateways.
- 17 new tests (12 pure-detector unit tests, 5 HTTP wiring integration
  covering off-hours/burst/quota-interaction/admin-overview-surfacing) —
  full suite **315/315**. Live-verified against the running local server:
  confirmed `stats.behavioralAnomalies24h` and
  `diagnostics.recentAnomalyFlags` appear correctly shaped on the real
  `/api/admin/overview` response, and a real request still submits
  successfully with the new check wired in.

**Note:** like quota/OTP state, the anomaly detector's per-officer
profiles are in-memory/per-process — a backend restart resets everyone's
baseline (identity-drift and pattern-shift comparisons start fresh). Same
acceptable-for-V1 tradeoff already noted for step 6.

**Step 10 — local end-to-end simulation — done (design doc §14.10). All 9
build-order steps proven working together, live, on localhost, using the
real backend process, real database, real Gmail SMTP, and real role-based
authorization — not just the (already-passing) automated suite.**

- **Real production discovered live during setup — plan changed
  immediately.** Starting the Telegram bridge locally to include it in the
  simulation immediately hit `409 Conflict: terminated by other getUpdates
  request` — confirming a **production bridge instance is live on the VPS
  right now**, serving real officers. The local bridge was killed within
  seconds. Telegram-message-dependent legs (registration DM, OTP reply,
  moderation commands, admin-post bypass) were re-scoped to HTTP-only
  simulation instead — calling the exact same backend endpoints the bridge
  would call, proving the backend logic for real without ever touching the
  live bot. No real moderation action (ban/mute) was attempted against the
  real group at any point.
- **Quota temporarily lowered for this run only**, via a new
  `QUOTA_MAX_REQUESTS`/`QUOTA_WINDOW_MS` env-var override added to
  `src/app.js` (defaults completely unchanged when unset — a small,
  permanent, low-risk addition, not a revert-after hack).
- **The user's real super_admin web account was linked to their real
  Telegram ID** (`linkTelegramId`, previously unlinked) so moderation-check
  and admin-post-bypass could be tested as a genuine authorized actor.
- **Full journey run against the real local server**, in order:
  1. Seeded a synthetic E2E test officer in the Personnel Registry via the
     real `/api/admin/personnel-registry/add` endpoint with a real
     super-admin session.
  2. Minted a real registration-link token
     (`/api/telegram/registration-link`).
  3. **Registered for real** (`/api/auth/register`) using an email the
     user controls (`opsbarishal@gmail.com`) — triggering a **real Gmail
     SMTP send** (confirmed by the absence of the "SMTP not configured"
     console fallback, the only path this session had never live-tested
     before now).
  4. Verified via the real emailed link (`/verify-email`, direct DB read
     of the plaintext `verify_token` — no need to wait on the inbox for
     this one).
  5. Logged in for real (`/api/auth/login`) — a second real email
     (MFA code) confirmed dispatched the same way.
  6. Tripped the (lowered) quota for real after 3 requests; **the user
     read the real re-verification code from their own inbox** and gave
     it to complete `/api/telegram/verify-code` end-to-end — the one leg
     that couldn't be self-served (OTP codes are hashed at rest, never
     stored in plaintext, matching the design's own security property).
     Confirmed the quota window actually reopened afterward.
  7. Confirmed `moderation-check` authorizes the linked super_admin and
     rejects a plain officer; confirmed `moderation-action` audits
     correctly (no real Telegram API call — the bridge alone can do that,
     see the 409-conflict note above).
  8. Confirmed the **admin-post bypass** end to end: the identical
     non-command Telegram-channel message got `ADMIN_POST_BYPASS`
     (silent) from the linked super_admin and a real
     `UNSUPPORTED_COMMAND` rejection from a plain officer — same input,
     role-differentiated outcome, proven live.
  9. Tripped `BURST_VOLUME` for real (9 rapid requests) and confirmed it
     fired **even on quota-blocked attempts** — both defenses working
     together as designed, not just each in isolation.
- **A real, previously-unknown bug was found and fixed as part of this
  step** (not a security-hardening-v1 defect — pre-existing, unrelated
  code, found only because this was genuine live testing rather than the
  mocked/fake-transport automated suite): `GET /api/audit/verify` reported
  a false "row hash mismatch" starting from the very first audit row ever
  written to this local database (2026-06-11). Root-caused precisely:
  `service.js`'s `createRequest()` call passed `channel`/`chatId`/
  `sourceMessageId` straight through as `undefined` when a caller omitted
  them (any non-Telegram submission path) — that survives in-memory (so
  the write-time audit hash included those keys), but `JSON.stringify()`
  silently drops `undefined`-valued object keys on persist, so **every**
  reload (a real server restart, or re-running the verify check) recomputed
  a different hash than the one originally written. Confirmed
  deterministically (not guessed) via a temporary, reverted export of the
  internal hashing function to compare the exact canonicalized strings.
  Impact was real: `verifyAuditChain()` stops at the *first* mismatch, so
  this false positive would have masked any genuine tampering on every row
  after it — undermining the actual tamper-evidence value of a system
  whose "output may support investigations" (the code's own words). Fixed
  by normalizing those three fields to `null` (matching the pre-existing
  pattern already used for `testDestination`), with a new regression test
  (`test/security.test.js`) that submits through the real
  `AutomationService` → persists to a real temp SQLite file → reloads via
  a fresh `AutomationStore` instance (simulating a real restart) →
  confirms the chain verifies clean. Verified fixed live too: a fresh
  request submitted after restarting the local server with the fix now
  round-trips with a matching hash (confirmed via the same temporary-export
  technique). Historical rows from before the fix remain unfixable without
  mutating audit data (which would itself be a worse practice) — flagged,
  not silently patched.
- Test data cleaned up afterward (synthetic officer account, registry
  record, temporary sessions) — audit log rows were deliberately **not**
  deleted, since removing rows would itself break chain integrity for no
  good reason; they're valid local-dev history now that the hash bug is
  fixed. Full suite **316/316**. Both local processes (backend, and the
  briefly-started-then-killed bridge) stopped cleanly at the end — nothing
  left running.

**All 10 steps of the locked build order are now done.** Per this
branch's standing instruction, no deployment happens until the user
explicitly reviews this status and approves moving to a deployment
conversation.

## Follow-on hardening: real page separation for Telegram-linked officers

Not part of the original 10-step order — added after the user asked how to
stop a Telegram-registered officer from being able to see "the original
website" at all, rather than just having its admin tabs hidden by JS.

- Root cause: the "Registered Officer" tier (§4 of the design doc) served
  the same `index.html`/`app.js` bundle used by admins, with admin-only
  tabs hidden client-side via `.officer-hide` (`public/app.js`). The
  underlying `/api/ops/*` data was already correctly blocked server-side
  (`requireAdmin`/`requireSuperAdmin`), but the markup and JS for those
  surfaces still reached the officer's browser — visible to anyone who
  opened devtools.
- Fix: the server already sets an `HttpOnly` session cookie at login
  (`src/cookies.js`) and gates `GET /` server-side via `guardPage()`
  (pre-existing infrastructure). Extended the `GET /` and new `GET
  /portal.html` handlers in `src/app.js`: a session with `role ===
  'officer'` **and** a linked `telegram_id` is served the new
  `public/portal.html` / `public/portal.js` instead of `index.html` —
  a small, self-contained page (account status + sign-out only) that never
  references `app.js` or contains any admin markup.
- Scope decision (confirmed with the user): only Telegram-*linked* officer
  accounts get the stripped page. Officers without a linked Telegram ID
  keep today's `index.html` + `.officer-hide` experience unchanged.
- Verified live, locally: created two temporary officer accounts (one
  Telegram-linked, one not) with real sessions, confirmed via curl that
  `GET /` and `GET /portal.html` branch correctly for both, confirmed via
  the browser preview that `portal.html` renders live account data
  correctly and that `app.js` is never requested by the linked officer's
  browser (checked network log), and confirmed sign-out from the portal
  correctly clears the session and returns to `/login.html`. Full suite
  still 316/316. Temporary test accounts and sessions removed afterward;
  local server stopped.
- Nothing deployed — same standing instruction as the rest of this branch.

## Open questions / notes found while implementing

- **Real personnel data received and imported into local dev (2026-07-08).**
  The user provided their actual roster ("Address Book.xlsx", 22 LIC
  Barishal officers) — imported into the local `data/auth.db` via
  `replaceRegistry()` (the same path the admin-upload endpoint uses) for
  step 6+ local testing. Two loader gaps surfaced and were fixed generally
  (not file-specific) in `src/personnelRegistry.js`:
  - Real-world header text — `Mobile Number(official)` / `Mail(official)`
    — wasn't in `COLUMN_ALIASES`; added.
  - Excel drops the leading `0` from any phone number stored in a
    numeric-formatted cell (`01320151100` round-trips as `1320151100`).
    `restoreDroppedLeadingZero()` now fixes any bare 10-digit phone value
    on import. Confirmed with the user this was the cause before writing
    the fix (their numbers use PABX-style prefixes like `0132...`, not
    standard `01[3-9]...` mobile prefixes — could easily have been mistaken
    for a different bug).
  - No duplicate (phone, email) pairs across the 22 imported records —
    verified before import (a few officers hold multiple posts/rows, but
    each with its own phone+email).
  - **This local import is dev-database-only** — it does not touch
    `config/telegram.json`, is not part of any commit, and does not exist
    in production. **Production still needs its own import** via
    `POST /api/admin/personnel-registry/import` before registration will
    work there, once this branch deploys.
- **Closing the Telegram group's "always open" policy** is the one piece of
  step 5's original scope intentionally left undone — needs a user decision
  on rollout (grace period for existing unregistered group members, likely
  mirroring the 1-week window already used for web accounts) once real
  registry data exists to make that safe to test.

(add here as they come up, so they don't get lost between sessions)
