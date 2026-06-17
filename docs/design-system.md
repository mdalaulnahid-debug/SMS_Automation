# Design System — SMS Gateway Web UI

Single source of truth for the look and structure of the two web apps in
`public/`:

- **Mobile user app** — `index.html` + `app.js` — quick-glance dashboard,
  built for checking from a phone.
- **Desktop admin console** — `admin.html` + `admin.js` — dense, table-based
  view for reviewers doing heavier workload at a desk. Lives at `/admin`.

Both link the same `theme.css` (tokens + shared component CSS) and load
`shared.js` before their own script (shared JS utilities: theme, auth,
`apiFetch`/`postJson`, formatting helpers, health poll, CSV/QR helpers).
Read this doc before designing or restyling any screen in either app, so new
work reuses these tokens instead of re-deriving them.

## Project context

This is a police-investigation SMS bridge. Officers request subscriber
location/info via Telegram (`LRL <msisdn>` style commands); the backend
routes the request to an Android gateway phone tied to the right mobile
operator (GP / ROBI / BANGLALINK), which sends the SMS to the operator's
short code and forwards the operator's reply back to the backend. A reviewer
approves the reply draft, then the Telegram bridge posts it back to the
requesting officer. See [`PHONE_GATEWAY_CONTRACT.md`](PHONE_GATEWAY_CONTRACT.md)
and [`telegram-bridge.md`](telegram-bridge.md) for the full backend contract.

The web UI in `public/` is **not** the officer-facing surface (that's
Telegram). It's the operator/reviewer dashboard for monitoring gateway health,
SMS traffic, and approving reply drafts. It was originally a single desktop
admin-table page, then redesigned into a **mobile-first 3-tab app** based on
Google Stitch (Material Design 3) reference screens — with the admin-only
workflows (approve/reject/retry, manual SMS match, audit export, dev tools)
kept inline but hidden behind an "unlock" gate. As admin workload grew, a
**second, separate desktop console** (`/admin`) was added for the same
workflows at higher density (tables instead of cards, no 480px cap). Both
apps share one backend and one admin key — see
[Two apps, one backend](#two-apps-one-backend) below for which one to extend.

## Structure: 3 tabs, bottom nav (mobile user app)

| Tab | Purpose | Visible to |
|---|---|---|
| **Home** | System status pulse, stats (today/active/completed/failed), gateway cards (GP/ROBI/BANGLALINK online/offline + last seen) | Everyone |
| **Logs** | Unified SMS + audit feed, search, filter chips (All/Sent/Received/Failed/System), success-rate stats | Everyone |
| **Settings** | Backend URL (read-only), API key input, theme toggle | Everyone |

Each tab has an **admin-only** section, hidden by default and revealed when
an admin API key is saved in `localStorage` (`adminApiKey`):

| Tab | Admin section |
|---|---|
| Home | Active Requests (reject/retry), Reply Drafts (approve), Unmatched SMS (manual match) |
| Settings | Provision Gateway Phone (QR), Audit Log (+ CSV export), Dev Tools (submit request / simulate inbound SMS) |

Unlocking admin is just typing the key into the Settings → Admin API Key
field — no separate login screen. **Sign-in/sign-up screens were explicitly
dropped** from scope; this project has no per-user auth system, only the
single shared admin key (`config/auth.json`) and per-gateway secrets.

## Structure: sidebar + tables (desktop admin console)

`admin.html` is gated by a **full-page** auth gate (`#authGate`), not an
overlay — the entire page is admin-only, so there's no "everyone" tier like
the mobile app's Home/Logs. Once unlocked (`adminApiKey` in `localStorage`,
verified live against `GET /api/gateways`), a left sidebar switches between
five sections, each a `.admin-section` toggled the same way the mobile app
toggles `.tab-panel`:

| Section | Contents |
|---|---|
| Overview | Stats (4-up), gateway cards (grid), operator queues table |
| Requests & Replies | Requests table (reject/retry) + reply drafts table (approve) |
| Unmatched SMS | Table with inline match-to-request dropdown |
| Audit Log | Search box, chain-integrity banner, full table, CSV export |
| Tools | Provision-QR form + Dev Tools forms, two-column |

No `max-width` cap on `body` — this page is meant to use real desktop width.
Cards (`.gw-card`, `.stat-card`) are reused from `theme.css`, but dense
record lists use `table.data-table` instead of the mobile app's stacked
`.req-card`/`.draft-card` — that's the deliberate difference between the two
apps (glanceable cards vs. scannable rows).

## Two apps, one backend

Both `index.html` and `admin.html` call the same endpoints and read the same
`adminApiKey`. They are **not** a split between "what admins can see" vs.
"what everyone can see" — nearly every dashboard endpoint already requires
`requireAdmin` server-side, so the mobile app effectively needs the key too.
The split is **device/workload**, not **permission**:

- Extend **`index.html`**/`app.js` for anything meant to be checked or acted
  on quickly from a phone (status check, approving one urgent draft).
- Extend **`admin.html`**/`admin.js` for anything that benefits from more
  screen space or scanning many rows at once (bulk review, searching audit
  history, provisioning).

It's fine for the same action (e.g. approve a reply draft) to exist in both —
that's intentional duplication of a workflow across two surfaces, not drift.
What must **not** duplicate is the underlying token/utility code — that's
why `theme.css` and `shared.js` exist; see below.

## Shared files

| File | Contains | Used by |
|---|---|---|
| `public/theme.css` | Color tokens (`:root`/`[data-theme="dark"]`), reset, icon util, `.pulse-dot`, `.chip`, `.stat-card`, `.gw-card`, `.banner`, `.btn-sm`, `.dispatch-badge`, `.empty`/`.error-text`/`code` | Both pages (`<link rel="stylesheet" href="/theme.css">`) |
| `public/shared.js` | `applyTheme`/`toggleTheme`, `authHeaders`/`isAdminUnlocked`/`apiFetch`/`postJson`, `relativeTime`/`esc`/`statusChipClass`/`renderDispatches`, `pollHealth`, `downloadCsv`/`auditLogsToCsv`, `generateProvisionQr`/`copyProvPayload` | Both pages, loaded via `<script src="/shared.js">` **before** the page's own script |

Each page still defines its **own** 401 handler via `window.onAuthRequired`
(the mobile app reopens its overlay; the admin console falls back to the
full-page gate) — that's the one piece `apiFetch` delegates back to the page
instead of hardcoding, since the two pages react to "you got logged out"
differently.

If a new utility is generic (no page-specific DOM ids) and would otherwise
be copy-pasted into both `app.js` and `admin.js`, it belongs in `shared.js`.
If it's visual and reusable across both pages' cards/tables, it belongs in
`theme.css`. Page-specific layout (bottom nav vs. sidebar, `.log-entry` vs.
`table.data-table`) stays in each page's own `<style>`/`<script>` block.

## Color tokens

Defined as CSS custom properties on `:root` (light, default) and overridden
under `[data-theme="dark"]`. Toggle by setting `data-theme` on `<html>`;
persisted to `localStorage('theme')`, default falls back to
`prefers-color-scheme`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg-page` | `#fdf7ff` | `#141317` | Page background |
| `--bg-surface` | `#ffffff` | `#1c1b1f` | Header, nav, cards-on-surface |
| `--bg-card` | `#f3edf7` | `#2b2930` | Stat cards, inset surfaces |
| `--bg-card-el` | `#ece6f0` | `#36343b` | Elevated card-on-card |
| `--text-primary` | `#1d1b20` | `#e6e1e5` | Headings, primary text |
| `--text-secondary` | `#49454f` | `#cac4d0` | Body text |
| `--text-muted` | `#79747e` | `#938f99` | Meta/timestamps/labels |
| `--divider` | `#cac4d0` | `#49454f` | Borders |
| `--accent` | `#6750a4` | `#d0bcff` | Brand, links, active nav, primary buttons |
| `--accent-on` | `#ffffff` | `#381e72` | Text on accent background |
| `--accent-bg` | `#eaddff` | `#4a4458` | Accent chip backgrounds, active nav pill |
| `--success` | `#2e7d32` | `#81c784` | Online, completed, sent-ok |
| `--success-bg` | `#e8f5e9` | `#1b3d1c` | Success chip background |
| `--danger` | `#b3261e` | `#f2b8b5` | Offline, failed, error text |
| `--danger-bg` | `#fce8e6` | `#601410` | Danger chip background |
| `--warning` | `#e37400` | `#f9c74f` | Needs-review, admin-section labels |
| `--warning-bg` | `#fef7e0` | `#3b2700` | Warning chip background |
| `--pulse-rgb` | `46, 125, 50` | `129, 199, 132` | Used in the status pulse `box-shadow` keyframe (rgba needs raw channels, not a hex token) |

Layout constants: `--header-height: 64px`, `--nav-height: 72px`. Body is
capped `max-width: 480px`, centered — this is a phone-width app shell even
on desktop browsers, intentionally (it's meant to be checked from a phone in
the field as often as from a desk).

Font: **Inter** (Google Fonts), icons: **Material Symbols Outlined**. Both
loaded via CDN `<link>` tags — no build step, no bundler, matches how the
rest of this project avoids tooling overhead.

## Component patterns

Reuse these class names — don't invent parallel ones for the same concept.

- **`.chip` + `.chip-success/-danger/-warning/-accent/-muted`** — small status
  pill (ONLINE/OFFLINE/COMPLETED/FAILED/etc). Background = `*-bg` token,
  text = base token.
- **`.stat-card`** — 2-up grid tile for headline numbers (Home stats).
  `.log-stat-card` is the 4-up variant used in the Logs stats row — same
  idea, smaller/denser.
- **`.gw-card`** — gateway status row: icon chip, name/id/last-seen, status
  chip on the right, 4px left border colored by state (`online` / `offline`
  / `mock`).
- **`.req-card` / `.draft-card`** — admin list items (requests, reply
  drafts, unmatched SMS). `.draft-text` is the monospace preformatted block
  inside them for SMS/reply bodies.
- **`.log-entry`** — one row in the unified Logs feed: colored dot
  (`.log-dot.sent/.received/.failed/.system`) + title/meta + badge on the
  right. Built by `buildUnifiedFeed()` in `app.js`, which merges
  `smsOutbox` + `smsInbox` + `auditLogs` into one sorted array tagged by type.
- **`.btn-sm` + `.btn-primary/-danger/-retry`** — inline action buttons on
  cards (Approve, Reject, Retry, Match).
- **`details.collapsible`** — accordion wrapper for the Settings → Admin
  tools (Provision QR, Audit Log, Dev Tools). Chevron rotates via the
  `[open] .chevron` selector; no JS needed for open/close state.
- **`.settings-group` / `.settings-row`** — iOS/MD3-style grouped list row
  (icon chip + label + value/control), used for Connection and Appearance
  sections in Settings.
- **`.admin-only`** — utility class, `display:none` by default, flipped to
  `block` by `updateAdminVisibility()` in `app.js` whenever `adminApiKey` is
  present in `localStorage`. Apply this to wrap *any* future admin-only
  block — don't build a second visibility mechanism.

## What NOT to reintroduce

- No top horizontal tab bar in the mobile app — replaced by the bottom
  3-tab nav. If a future mobile screen needs sub-navigation, prefer the
  `.filter-chip` pattern (horizontal scroll chips, see Logs tab) over the
  old `.sub-tab-btn` pattern.
- No per-user sign-in/sign-up screens in **either** app. Admin unlock is an
  inline API-key field (Settings on mobile, full-page gate on admin); keep
  it that way unless the project actually grows multi-user auth (it
  currently has none — see [`telegram-bridge.md`](telegram-bridge.md) for
  why Telegram, not a web login, is the officer-facing channel).
- No desktop-wide layout **in `index.html`**. Keep its 480px-max app-shell
  constraint even for new mobile screens — that's deliberate (field-usable
  from a phone), not an oversight. `admin.html` is the intended place for
  desktop-width work; don't widen the mobile shell instead of using it.
- No third app/page for "yet another admin view." If admin tooling needs a
  new surface, it's a new section in `admin.html`'s sidebar, not a new file.
- No duplicated copies of tokens or generic JS helpers across `index.html`/
  `admin.html`. If you catch yourself pasting the same color values or the
  same function into both pages, move it into `theme.css`/`shared.js`
  instead (see [Shared files](#shared-files)).
- Signal strength / battery level on gateway cards are **intentionally
  omitted** — the Android gateway app does not currently report them. Don't
  add UI for them without first adding the corresponding field to the
  `POST /api/gateways/register` payload and `store.registerGateway()`.

## Source of truth

The live implementation is `public/index.html` + `public/app.js` (mobile
user app), `public/admin.html` + `public/admin.js` (desktop admin console),
and the shared `public/theme.css` / `public/shared.js`. This doc describes
intent and tokens; if they ever disagree, the running code wins — update
this file to match, don't silently let it drift.
