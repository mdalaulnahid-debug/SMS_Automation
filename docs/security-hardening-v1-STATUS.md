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

## Status by component (per design doc §14 build order)

| # | Component | Status |
|---|---|---|
| 1 | Unit tests in isolation: registry-match, quota logic, OTP generation/expiry/attempts | **Done** (24 tests, `src/personnelRegistry.js`, `src/quota.js`, `src/otp.js`) |
| 2 | Server-side page gating (4-tier) | **Done** for `/` and `/admin` (see scoping note below) |
| 3 | `telegramId` + identity unification | **Done** (schema migration + link/lookup methods; bridge cutover deferred, see note below) |
| 4 | Personnel Registry data model + admin-upload loading | **Done** |
| 5 | Registration flow end-to-end | **Done** for the web + bridge-link mechanics (see scoping note below — closing the group-chat "always open" policy itself is deliberately deferred) |
| 6 | Quota + email-OTP re-verification middleware | Not started |
| 7 | Admin group actions (post-bypass + moderation) | Not started |
| 8 | Shared admin key scoping/retirement | Not started |
| 9 | Behavioral anomaly tripwire | Not started |
| 10 | Local end-to-end simulation | Not started |

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
