# Session Memory — SMS Automation

Fast-orientation file for any Claude session. Read this first, then only open the
specific files you need. Deeper detail lives in `progress_tracker.md` (latest
session handoff), `todo.md` (running task log), and `docs/`.

## What this project is

A **police-investigation SMS bridge** for LIC Barishal (Bangladesh Police).
Authorized officers send formatted lookup commands to a **Telegram bot**; the
backend routes each request to an **Android gateway phone** tied to the right
mobile operator (GP / ROBI / BANGLALINK), which SMSes the operator's shortcode
and forwards the reply back. A human **reviewer approves** the reply draft, then
the bridge posts it to the officer on Telegram. Every step is written to a
tamper-evident, hash-chained **audit log**.

Commands: `LRL`, `LCL`, `MS-NID`, `NID-MS`, `IMEI-MS` (+ identifier args).

## Architecture — four surfaces, one backend

| Surface | Path | Audience |
|---|---|---|
| Web Operations UI | `public/index.html` + `public/app.js` (`/`) | quick monitoring, phone or desk |
| Web Admin Console | `public/admin.html` + `public/admin.js` (`/admin`) | reviewers: approvals, audit, exceptions |
| Android Gateway App | `android-gateway/app` | runtime on each operator phone |
| Android Admin App | `android-gateway/adminapp` | mobile supervisor (separate APK) |

**Backend:** Node.js, entry `src/server.js` (port 3000). No build step anywhere —
web is vanilla HTML/CSS/JS; shared tokens in `public/theme.css`, shared helpers in
`public/shared.js`. Key backend modules: `src/app.js` (`buildAdminData()` — the
central computation all surfaces reshape), `src/domain.js`, `src/parser.js`,
`src/persistence.js`, `src/userAuth.js` (login/sessions, `data/auth.db`),
`src/network.js`, `src/mailer.js`. SQLite: `data/automation.db`, `data/auth.db`.
Telegram bridge is a **separate** process: `telegram-bridge/` (`npm run start:telegram`).

## Auth model

- Officers/admins log in with per-person accounts (`/login.html`, session tokens,
  `/api/auth/me`). Legacy fallback: a shared admin API key.
- Admin gate needs role `admin`/`super_admin`; officers get redirected to `/`.
- **Telegram authorized users** (private-DM intake gating) live in
  `config/telegram.json` → `authorizedUsers` (object keyed by Telegram user ID).
  The **admin panel writes these directly on the VPS** — the bridge reads them at
  startup, so adding/removing a user requires `pm2 restart sms-bridge`.

## Deploy — production VPS

- `bash scripts/deploy.sh` (run from Git Bash). Targets `root@45.77.240.195`,
  `/opt/sms-backend`. scp's `src/`, `public/`, `telegram-bridge/`, training data,
  scripts; `npm install --omit=dev`; `pm2 restart sms-backend sms-bridge`.
- **Live at `https://ops.licbarishal.gov.bd`** (`/admin` for the console).
- **`config/telegram.json` and `config/mail.json` are NEVER overwritten** by
  deploy (copied on first bootstrap only) — they're runtime-owned; edits made via
  the admin console or by hand on the VPS are safe. `mail.json` is gitignored and
  must be created by hand on the VPS.
- **Deploy is gated:** only run `deploy.sh` on an explicit per-change instruction
  to deploy. A bug report alone is not authorization.

## Design system (current)

Web UI runs a **Material-3 "ROMER Command Grid"** reskin (2026-07-04): **teal**
interactive accent (`--accent #44e2cd` dark / `#0f766e` light), surface-container
elevation ramp, softer shadows, dark + light (AA contrast), brand navy `#04014b`
kept for the insignia. Tokens live in `public/theme.css` (`:root` = dark default,
`[data-theme="light"]` override) — **the token source of truth**. Admin review
surface is an **"Approvals Queue"** master-detail (Pending/Resolved/Archived
tabs). Icons: Material Symbols Outlined. Fonts: Manrope (UI) + IBM Plex Mono
(`--font-mono`, IDs/logs).

**→ Full design system:** [`docs/design-system.md`](docs/design-system.md) is the
maintained narrative doc (color-token table, component patterns, Android parity,
changelog). Read it before touching any token or component class; it cross-links
back here for project context.

**Open follow-up:** Android `colors.xml` not yet re-synced to teal (parity broken).

## Frontend stack & planned direction

**Current:** vanilla static HTML/CSS/JS, **no build step, no framework** — the
browser runs `public/*.html` + `*.js` directly, and `deploy.sh` just copies the
files. Simple, but React-native AI design tools (magic MCP, v0, shadcn/ui, Claude
Design code export) can't drop their output in; it has to be hand-translated.

**Planned (`P1`, staged, not started):** migrate `public/` → a **React + Vite
SPA** (recommended: TypeScript + Tailwind with the teal M3 tokens ported into the
Tailwind theme; new app in `web/`) so those AI tools work directly. Build + verify
on **localhost first**, deploy to VPS only after a parity pass; old `public/` kept
for rollback. This adds a `npm run build` step to the deploy pipeline. Full plan +
phase list with priorities in `todo.md` (PLANNED section) and
`progress_tracker.md` (latest handoff). Backend/bridge/Android/auth/APIs unchanged.

## Planned feature — Lost/Stolen Phone Recovery Watch (GD-linked)

**Design only (2026-07-06), not started, `P2`.** Register a GD (police General
Diary entry) -linked "watch" on stolen IMEIs; the system re-runs `IMEI-MS`
against all operators every 24h and DMs admins/IO if the phone resurfaces on a
new number after the GD date. Reuses the existing request/dispatch/reply
pipeline (new `channel: 'gd-watch'`) rather than building a parallel system —
see full design, data model, and edge cases in
[`docs/gd-lost-phone-watch-design.md`](docs/gd-lost-phone-watch-design.md).
To be built and tested entirely on **localhost first**, per standing policy.

## In progress — Security hardening V1 (registration gating + layered access)

**Design locked (2026-07-07), implementation starting, `P1`.** Closes 3 real
gaps found by code review: page-level access is client-side only (no
server-side role check before `/`, `/admin` serve their HTML), Telegram
identity and web-login identity have never been linked, and no registration
validates against real personnel data. V1 adds: server-enforced 4-tier
access (Public/Registered Officer/Admin/Super-admin), a Personnel Registry
that registration must match, `telegramId` unifying the two identity
systems, a 1-week Telegram-delivered registration window for existing
users (auto-activate during the window, approval-gated after), quota +
email-OTP re-verification as impersonation defense (Telegram exposes no
IP/device — confirmed, not assumed), admin group moderation actions, and
retirement of the shared admin key as a human credential. Full design,
migration plan, and build order in
[`docs/security-hardening-v1-design.md`](docs/security-hardening-v1-design.md).
**Being built on its own branch, `feature/security-hardening-v1`, isolated
from `main`/production** — localhost-only until a full pass, deploy only
after explicit approval, same discipline as the GD lost-phone watch feature.

## Conventions / gotchas

- Grid tracks that hold long tokens (gateway ids, `REQ-…`) must use
  `minmax(0, 1fr)` + `overflow-wrap:anywhere`, else they clip out of
  `overflow:hidden` cards (documented, bitten twice).
- `/index.html` and `/admin.html` serve a tiny redirect stub; `/` and `/admin`
  serve the real pages — grep the real path, not the `.html`.
- Commit/push only when asked; end commit messages with the Co-Authored-By line.
- Local prototype: `node src/server.js` serves web + API only (NOT the bridge), so
  it can't touch the live Telegram bot — safe for local testing at localhost:3000.

## Where to look next

- Latest work + open follow-ups → `progress_tracker.md` (Session Handoff, newest first)
- Task log → `todo.md`
- Backend contract → `docs/PHONE_GATEWAY_CONTRACT.md`, `docs/telegram-bridge.md`
- Matching/validation rules → `docs/training-and-matching-rules.md`
- Design tokens/components → `docs/design-system.md`, `public/theme.css`
- Planned: lost-phone recovery watch (GD-linked) → `docs/gd-lost-phone-watch-design.md`
- In progress: security hardening V1 (registration/access tiers) → `docs/security-hardening-v1-design.md`
- Code knowledge graph (if built) → `graphify-out/GRAPH_REPORT.md` + `graph.json`
  (query with `graphify query "<question>"` instead of re-reading files)
