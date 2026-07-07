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
| 5 | Registration flow end-to-end | Not started |
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

## Open questions / notes found while implementing

(add here as they come up, so they don't get lost between sessions)
