# Security Hardening — Registration Gating, Layered Access & Impersonation Defense (V1, locked scope)

**Status:** design locked, implementation starting on
`feature/security-hardening-v1`, isolated from `main`/production. Built and
fully tested on **localhost only**; deploy only after a full local pass and
explicit approval — same discipline as
[`docs/gd-lost-phone-watch-design.md`](gd-lost-phone-watch-design.md).

Cross-links: [`SESSION_MEMORY.md`](../SESSION_MEMORY.md) · [`architecture.md`](../architecture.md)
(current implemented system, esp. §11 Security Model) · [`todo.md`](../todo.md)
(2026-06-24 security roadmaps this supersedes/consolidates) ·
[`progress_tracker.md`](../progress_tracker.md).

## 1. What this is

A consolidated hardening pass closing three real gaps found by direct
code review (not assumption):

1. **Page-level access is client-side only.** `src/app.js:446-469` serves
   `/`, `/admin`, `/admin.js`, `/app.js` unconditionally — no server-side
   role check before the HTML/JS ships. API endpoints behind them are
   mostly gated (`requireAdmin`/`requireAnySession`), but the page shells
   and their JS structure are visible to anyone, authenticated or not.
2. **Two disjoint identity systems.** Web login (`auth_users` in
   `userAuth.js`, email/password) and Telegram gating
   (`config/telegram.json` → `authorizedUsers`, DM-only; group is fully
   open) have never been linked. A Telegram sender and a web account are
   unrelated identities today.
3. **No proof-of-personnel check anywhere.** Anyone can self-register a web
   account with any email, and the Telegram group accepts commands from any
   member. Nothing validates a sender is an actual, vetted officer.

## 2. Goals & non-goals

**Goals**
- Server-enforced, role-based page/API access (four tiers, §4).
- Registration gated against a real Personnel Registry (name/designation/
  unit/official phone/official email) — self-declared identity is never
  trusted.
- Bridge Telegram identity and web identity into one account per person.
- Defend against account-impersonation-from-a-different-device without
  relying on anything Telegram doesn't expose (it exposes no IP/device ID —
  confirmed, not assumed).
- Give admins the ability to post any message and take moderation actions
  (ban/suspend/mute) in the Telegram group.
- Retire the shared admin API key as a human credential (machine-to-machine
  only going forward).
- Add a low-cost behavioral anomaly tripwire and encryption at rest.

**Non-goals (V1)**
- No device-bound push/TOTP second factor yet — that needs the not-yet-built
  officer app (V2, §9).
- No IP/device fingerprinting of Telegram senders — not technically possible
  (Telegram's Bot API does not expose it under any field).
- Not a rewrite of the frontend framework — this rides on the existing
  vanilla HTML/JS shell; the planned React+Vite migration (`P1` in
  `todo.md`) is a separate, later initiative, but should absorb this
  access-tier restructuring when it happens rather than redoing it twice.

## 3. Migration plan (agreed 2026-07-07)

- **1-week registration window.** Every currently-active officer/admin gets
  a registration link delivered via Telegram (bot DM or group announcement)
  at rollout. They must register (validated against the Personnel Registry)
  within that week.
- **During the window: auto-activate on registry match.** A registration
  whose phone+email match the same registry record is activated
  immediately — no approval bottleneck during the mass-onboarding burst.
  Every registration is still logged and surfaced in a review queue so a
  super-admin can retroactively audit or revoke.
- **After the window closes: switch to approval-gated.** New registrations
  (new hires, trickling in one at a time going forward) require explicit
  super-admin approval before activation — the second-reviewer pattern
  already used for GD cases. This is a deliberate policy flip at a known
  cutover point, not a permanent auto-activate rule.
- **The open-group policy intentionally ends.** Group chat is currently
  open to any member (`SESSION_MEMORY.md` Auth model); this change closes
  it — every sender must be a registered, registry-verified account.
  Confirmed as an intentional behavior change for all current users.
- **Lockout safety:** nothing in this migration silently locks anyone out
  mid-week — unregistered senders get the registration-link prompt instead
  of being rejected outright, until the window closes.

## 4. Access-tier model (server-enforced)

| Tier | Who | Sees |
|---|---|---|
| **Public** | Anyone, unauthenticated | One static informational page only — what the system is, no operational content. |
| **Registered Officer** | Registry-verified, logged in | Same informational page + their own account/quota status. No monitoring surfaces — operational work stays in Telegram. Officers whose account is linked to a Telegram ID are served a genuinely separate, minimal page (`portal.html`/`portal.js`) rather than the operational app with tabs hidden — see the follow-on hardening note below. |
| **Admin** | `role=admin` | Everything currently on the Ops + Admin pages: fleet, activity, approvals queue, unmatched, audit, phone-inbox, group moderation. |
| **Super-admin** | `role=super_admin` | All of Admin + Personnel Registry management, registration-approval queue (post-migration), GD-case approval, system config, key management. |

**Enforcement is two-layered, not one:** the server must check role **before
serving the page** (redirecting insufficient roles, not just letting the JS
hide DOM nodes), in addition to the existing API-level `requireAdmin`/
`requireAnySession` checks, which stay as-is.

**Follow-on hardening (post step-10):** the original implementation of the
"Registered Officer" tier served the same `index.html`/`app.js` bundle to
everyone and relied on client-side JS (`.officer-hide`) to hide admin-only
tabs — the markup and logic still shipped to the officer's browser, just
hidden, so a technical user could reveal it via devtools even though the
underlying `/api/ops/*` data stayed correctly blocked server-side. Since the
server already sets an `HttpOnly` session cookie at login (`src/cookies.js`)
and gates `GET /` server-side via `guardPage()`, this was extended: a
session whose `role === 'officer'` **and** whose account has a linked
`telegram_id` is served `public/portal.html`/`public/portal.js` instead —
a separate, minimal file with no admin markup or admin JS in it at all.
Verified via network logs that `app.js` is never fetched by such a session.
Non-Telegram-linked officers (e.g. accounts created before this existed, or
via a path with no Telegram link) are unaffected and still get the existing
`index.html` shell with `.officer-hide` gating.

## 5. Identity unification

- Add a `telegramId` column to `auth_users` (`userAuth.js`) — the join key
  between the two systems.
- Registration flow, end to end:
  1. Unregistered Telegram sender sends anything request-shaped (group or
     DM) → bot replies with a registration link carrying their Telegram
     user ID as a signed token.
  2. Officer fills the web form: Name, Designation, Unit, Official Phone,
     Official Email.
  3. Backend looks up phone **and** email against the Personnel Registry —
     both must match the *same* record, or registration is rejected.
  4. On match: account created in `auth_users`, `telegramId` set from the
     token, activation per §3's window-dependent policy.
- The Telegram bridge's intake check (`bridge.js`/`planIntake`) switches
  from reading `config/telegram.json`'s flat `authorizedUsers` map to
  checking `auth_users` by `telegramId` — one identity, one source of
  truth. `config/telegram.json`'s `authorizedUsers` is retired once this
  lands (kept only as an emergency fallback until the cutover is verified).

## 6. Personnel Registry

- New reference dataset: name, designation, unit, official phone, official
  email — the user's ground truth, provided separately.
- Loaded via an admin-uploaded spreadsheet, mirroring the existing
  `Training Data/Automation/*.xlsx` pattern already used in this project for
  reference data, rather than inventing a new import format.
- A super-admin console screen to view/update/re-import the registry later.
- Registration validation logic lives against this table; it is never
  self-declared data.

## 7. Impersonation defense: quota + out-of-band re-verification

Telegram gives no device/IP signal (confirmed against the Bot API — no
field carries it), so device-level detection is impossible on that channel.
Instead: make the *action* impossible without proof of possession of the
officer's real, registry-verified contact channel.

- Each officer has a request quota: **count AND time window**, whichever
  trips first (e.g. 20 requests OR 4 hours), admin-tunable per officer.
- On breach, a fresh one-time code is sent to the officer's
  **registry-verified** official email (SMS deferred — see §8) — not a
  self-reported contact.
- Officer replies with the code (in the Telegram DM where the challenge
  appeared) to reopen a verified session.
- Hardening on the challenge itself: code expires in minutes, capped retry
  attempts before a short lockout, capped codes-per-hour (anti-spam of the
  officer's own inbox). Every quota-hit, challenge, success/failure is
  audit-logged.
- **What this defeats:** someone driving the officer's Telegram account
  from a different device (borrowed phone, Telegram Web on a desktop) has
  the account but not the registry-verified email inbox — the challenge
  reaches the real officer, not the impersonator's device. The wall stops
  them.
- **What this does not defeat:** an attacker holding the officer's actual
  phone with both Telegram and email logged in — no out-of-band method can
  distinguish that from the legitimate officer. That is a device-seizure
  problem, not an impersonation-from-elsewhere problem, and is explicitly
  out of scope for V1.

## 8. Channel choice: email now, SMS deferred

Email is the V1 default: the mailer already exists and works (Gmail SMTP,
confirmed live), every registered account has a verified email. SMS is
deferred because it would consume operator-gateway SIM credit (mixing
OTP-delivery with operator-query traffic on the same SIMs), and officer
personal numbers for a dedicated OTP route aren't collected yet. Revisit if
a separate, cheap SMS route is added later.

## 9. Admin group actions

- **Post-any-message:** admins can send alerts/notices in the group without
  the bot's command validation rejecting them as unsupported (an `isAdmin`
  flag check in `planIntake()` bypassing normal validation for admin
  senders).
- **Moderation:** ban/suspend/mute via bot commands, using the Telegram Bot
  API's `banChatMember`/`restrictChatMember`/`unbanChatMember`/
  `deleteMessage`. **Prerequisite: the bot must be promoted to group admin**
  with those specific rights — an operational step outside this codebase,
  needed before this feature can function.
- Every admin message and moderation action is audit-logged (actor,
  action, target, timestamp).

## 10. Shared admin key retirement/scoping

- The legacy `adminApiKey` (`config/auth.json`) is retired as a *human*
  credential — `requireAdmin` stops accepting it for person-facing actions.
- Kept, narrowly, for genuine machine-to-machine callers if any exist
  (verify at implementation time whether anything besides humans currently
  uses it — the Telegram bridge itself uses its own `adminApiKey` from
  `config/telegram.json` to call back into the backend, which is a
  legitimate machine-to-machine use and should be preserved, just not
  reachable as a substitute for a human's session).
- All human admin/super-admin actions require a named session going
  forward — this is also what makes the GD-watch "different approver"
  second-reviewer gate enforceable (flagged as a dependency in
  `gd-lost-phone-watch-design.md`'s review findings).

## 11. Behavioral anomaly tripwire

Runs on metadata already available (no new Telegram capability needed):
off-hours submission timing, burst/bulk volume, `language_code` or username
drift for a given account, sudden request-type pattern shift. Flags surface
to admins as review items, not automatic blocks — this is a soft net
underneath the hard quota/OTP wall, not a replacement for it.

## 12. Encryption at rest

Carried over from the 2026-06-24 audit (`todo.md`): no disk encryption on
the VPS today. Recommended first step: Vultr encrypted block storage
(~$5-10/mo, ~1hr, AES-256 provider-managed) for `data/`. Application-level
field encryption is a further, optional, higher-effort step — not required
for V1.

## 13. Optimization notes (flagged, not urgent)

The in-memory-working-set + SQLite-write-through pattern (`store.js`) is
fine at current scale. Two things to watch as registration grows the user
base and GD-watch adds daily background dispatches: `buildAdminData()`
recomputes over *all* requests on every dashboard poll (will want
pagination/indexing as volume grows), and in-memory scans like
`listRequests().find(...)` are O(n). Not required for V1; noted so it isn't
a surprise later.

## 14. Build order (strict, unit-tests-first — same discipline as GD)

1. Unit tests in isolation: registry-match validation logic, quota
   count/time-window logic, OTP generation/expiry/attempt-limiting — no DB,
   no server.
2. Server-side page gating (the foundational fix — everything else assumes
   it exists). Regression tests: unauthenticated/wrong-role requests to
   `/`, `/admin` get redirected, not served.
3. `telegramId` column + identity-unification plumbing, with migration
   path for the bootstrap super-admin account.
4. Personnel Registry data model + admin-upload loading.
5. Registration flow end-to-end (Telegram link → form → registry check →
   activation per §3's policy).
6. Quota + OTP re-verification middleware.
7. Admin group actions (post-bypass + moderation commands) — requires the
   bot-promoted-to-group-admin prerequisite confirmed first.
8. Shared admin key scoping/retirement for human paths.
9. Behavioral anomaly tripwire.
10. Local end-to-end simulation: full registration → quota-breach →
    OTP-challenge → admin-moderation flow, on localhost, before any
    deployment conversation.

Everything built and run on **localhost only**. Do not run
`scripts/deploy.sh` or discuss VPS deployment until a full local pass is
complete and explicitly approved.

## 15. V2 (later, with the officer app)

Swap the emailed OTP step-up for a **device-bound** second factor — TOTP
seed or push-approval enrolled once via QR (reusing the pattern already
built for gateway provisioning in the Android apps). Same quota trigger,
strictly stronger proof: tied to one physical device instead of an email
channel.
