# Design System — SMS Automation Web UI

Single source of truth for the **web** token/component implementation in
`public/`. For the product-level direction this implements, read
[`ui-design-guide-v2.md`](ui-design-guide-v2.md) (visual direction, why we
moved off Material purple) and [`system-design-v2.md`](system-design-v2.md)
(the four-surface architecture this doc's "two apps, one backend" section
maps onto). Read this doc before touching any token or component class in
either web page, so new work reuses what's here instead of re-deriving it —
and if you change a token here, you are very likely also touching
`android-gateway/app`'s `colors.xml` (see
[Token parity with the Android Gateway App](#token-parity-with-the-android-gateway-app)).

> **2026-06-18 note:** this doc previously documented an MD3 purple palette
> (`--accent: #6750a4`) that **no longer exists in the code**. The web UI was
> rewritten to the "Operations Surface" cyan/slate palette described below.
> If you're reading an old copy of this file or a cached summary, throw it
> out — the table in [Color tokens](#color-tokens) is the only one that's
> still true.

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
Telegram). It's the operator/reviewer surface for monitoring gateway health,
SMS traffic, and approving reply drafts — one of four client surfaces
(`system-design-v2.md` §1) talking to the same backend authority:

| Surface | Lives at | Audience |
|---|---|---|
| Web Operations UI | `public/index.html` + `app.js` (`/`) | quick monitoring from a phone or desk |
| Web Admin Console | `public/admin.html` + `admin.js` (`/admin`) | desk-based reviewers, heavier workload |
| Android Gateway App | `android-gateway/app` | the device runtime on each operator phone |
| Android Admin App | `android-gateway/adminapp` | mobile supervisor, separate APK |

This doc covers the first two in full, and the color-token relationship to
the third and fourth — all four now share the same dark "Operations Surface"
palette (`accent #3dd7ff`, `bg_primary #08111f`, etc.) so the Gateway App
phone and the Admin App phone read as the same product. See
[Token parity](#token-parity-with-the-android-gateway-app) for details.

## Structure: 3 tabs, bottom nav (Web Operations UI)

| Tab | Purpose | Visible to |
|---|---|---|
| **Home** | Posture banner, fleet status by operator, "Needs Attention" (pending/failed/unmatched), recent activity | Everyone |
| **Activity** | Searchable event timeline with severity filter chips (All/Critical/Warning/Success/Info) | Everyone |
| **Access** (Settings) | Theme toggle, backend connection display, admin-key unlock, restricted tools | Everyone |

Data comes from `GET /api/ops/overview` and `GET /api/ops/activity` — both
thin, role-appropriate reshapes of the same `buildAdminData()` computation
the other three surfaces use (`src/app.js`). The mobile app does not call
`/api/admin/*` directly; if a screen here needs a field the `/api/ops/*`
shape doesn't expose, add it to `buildOpsData()` in `src/app.js`, don't
route around it.

Admin-only tools (Provision QR) live inside the **Access** tab behind
`.admin-only`, revealed once an admin API key is saved — see
[`.admin-only`](#component-patterns). There is no separate "Logs" tab
anymore; the old card-stacked SMS log was replaced by the Activity tab's
timeline.

## Structure: sidebar + sections (Web Admin Console)

`admin.html` is gated by a **full-page** auth gate (`#authGate`), not an
overlay — the whole page is admin-only. It redirects phone-width visitors
(`window.innerWidth < 900`) back to `/` automatically; append `?desktop=1`
to force-load it anyway. Once unlocked, a left sidebar (`.admin-sidebar`)
switches between sections, each an `.admin-section` toggled like the mobile
app toggles `.tab-panel`:

| Section | Contents |
|---|---|
| Overview | Stats row, fleet grid, escalation feed |
| Requests & Replies | Requests + reply-draft review (reject/retry/approve) |
| Unmatched SMS | Inline match-to-request dropdown |
| Audit | Search, chain-integrity banner, CSV export |
| Tools | Provision-QR, dev tools |

Calls `/api/admin/*` directly (`overview`, `requests`, `replies`,
`unmatched`, `audit`) — the full-fidelity surface, not the trimmed ops
shape. No `max-width` cap on `body`; this page is meant to use real desktop
width with grid layouts (`.overview-grid`, `.fleet-grid`), not a centered
phone-width column.

## Two apps, one backend

Both pages call into the same `buildAdminData()` computation (directly via
`/api/admin/*`, or trimmed via `/api/ops/*`) and read the same `adminApiKey`.
The split between them is **device/workload**, not **permission** — nearly
every endpoint already requires `requireAdmin` server-side:

- Extend **`index.html`**/`app.js`** for anything meant to be checked or
  acted on quickly from a phone.
- Extend **`admin.html`**/`admin.js`** for anything that benefits from more
  screen space or scanning many rows at once.

It's fine for the same action (e.g. approve a reply draft) to exist in
both — that's intentional duplication of a *workflow* across two surfaces,
not drift. What must **not** duplicate is token/utility code — that's why
`theme.css` and `shared.js` exist.

## Shared files

| File | Contains | Used by |
|---|---|---|
| `public/theme.css` | Color tokens (`:root` = dark default, `[data-theme="light"]` override), reset, `.glass-panel`/`.surface-panel`, `.chip`, `.kpi-tile`, `.operator-rail`, `.data-surface`, `.dispatch-badge`, `.btn-*`, `.banner`, `.timeline`, `table.data-table` | Both pages |
| `public/shared.js` | `applyTheme(mode)`/`toggleTheme`, `authHeaders`/`isAdminUnlocked`/`apiFetch`/`postJson`, `esc`/`relativeTime`/`formatAbsoluteTime`, `statusTone`/`statusChipClass`, `operatorTone`, `renderDispatches`, `pollHealth`, `auditLogsToCsv`/`downloadCsv`, `generateProvisionQr`/`copyProvPayload` | Both pages, loaded via `<script src="/shared.js">` **before** the page's own script |

Each page defines its own 401 handler via `window.onAuthRequired` (mobile
reopens its overlay; admin console falls back to the full-page gate) — the
one piece `apiFetch` delegates back to the page instead of hardcoding.

**Note the default flipped**: `:root` is now the *dark* palette and
`[data-theme="light"]` is the override — opposite of the old MD3 system,
where light was the default. `initTheme()` in `shared.js` still falls back
to `prefers-color-scheme` if nothing is saved.

## Color tokens

| Token | Dark (`:root`, default) | Light (`[data-theme="light"]`) | Use |
|---|---|---|---|
| `--bg-page` | `#08111f` | `#edf4fb` | Page background (plus a radial-gradient wash, see `body` rule) |
| `--bg-page-alt` | `#0b1628` | `#dfeaf6` | Gradient end stop |
| `--bg-surface` | `rgba(12,20,35,.92)` | `rgba(255,255,255,.94)` | Header/topbar, frosted via `backdrop-filter: blur(18px)` |
| `--bg-panel` | `rgba(18,29,48,.96)` | `rgba(255,255,255,.98)` | `.data-surface`, `.kpi-tile`, `.timeline-item` |
| `--bg-panel-2` | `rgba(23,37,59,.98)` | `rgba(244,248,252,.98)` | Inputs, table toolbar, secondary buttons |
| `--bg-panel-soft` | `rgba(18,30,49,.72)` | `rgba(244,248,252,.84)` | `.icon-btn` resting state |
| `--bg-overlay` | `rgba(4,10,20,.72)` | `rgba(14,24,42,.24)` | Auth gate backdrop |
| `--text-primary` | `#ebf3ff` | `#102038` | Headings, primary text |
| `--text-secondary` | `#b2c0d9` | `#41536d` | Body text |
| `--text-muted` | `#7f91af` | `#72839c` | Meta/timestamps/labels |
| `--divider` / `--divider-strong` | `rgba(128,156,196,.18)` / `.32` | `rgba(36,62,95,.12)` / `.22` | Borders |
| `--accent` | `#3dd7ff` | `#007fa6` | Brand, focus rings, active nav, `kpi-tile` glow, primary buttons |
| `--accent-2` | `#7c8cff` | `#4f63e2` | Secondary accent (gradients, `accent_muted` parity) |
| `--accent-on` | `#041018` | `#ffffff` | Text on accent-filled surfaces |
| `--accent-bg` / `--accent-border` | `rgba(61,215,255,.12)` / `.34` | `rgba(0,127,166,.1)` / `.25` | Accent chip backgrounds/borders |
| `--success` / `--success-bg` | `#56d88b` / `rgba(86,216,139,.14)` | `#1f9d59` / `rgba(31,157,89,.12)` | Online, completed, sent-ok |
| `--warning` / `--warning-bg` | `#ffbf5f` / `rgba(255,191,95,.14)` | `#b57000` / `rgba(181,112,0,.12)` | Needs-review, pending |
| `--danger` / `--danger-bg` | `#ff6d7f` / `rgba(255,109,127,.14)` | `#cf3752` / `rgba(207,55,82,.12)` | Offline, failed, error text |
| `--violet` / `--violet-bg` | `#9d8cff` / `rgba(157,140,255,.12)` | `#6559d8` / `rgba(101,89,216,.1)` | Reserved supporting accent — not a primary brand color (per `ui-design-guide-v2.md` §3) |
| `--operator-gp` / `--operator-robi` / `--operator-banglalink` | `#5ad678` / `#ff7997` / `#ffaf59` | *(dark only — see note)* | Operator identity rails (`.fleet-rail`, `.operator-mini .head`) |
| `--pulse-rgb` | `61, 215, 255` | `0, 127, 166` | Raw channels for the status-pulse `box-shadow` keyframe (can't put rgba inside a hex token) |
| `--shadow-md` / `--shadow-lg` | dark-tuned | light-tuned | `.glass-panel`/`.surface-panel`/`.data-surface` elevation |
| `--radius-sm/md/lg` | `10px` / `16px` / `22px` | same | Shared corner radii |

Operator identity colors (`--operator-*`) are currently only defined under
`:root` (dark) — there's no light-theme override yet. If you're working in
light mode and an operator rail looks wrong, that's why; add the
light-theme triplet to `[data-theme="light"]` rather than hardcoding a color
on the element.

Fonts: **Manrope** (UI text) + **IBM Plex Mono** (`--font-mono`, used for
IDs/payloads/logs via `.mono`/`code`) + **Material Symbols Outlined**
(icons), all loaded via Google Fonts CDN `<link>` tags — no build step.

## Component patterns

Reuse these — don't invent parallel ones for the same concept. Note the
shape language deliberately moved **away from cards** (`ui-design-guide-v2.md`
§2/§7): prefer rails, strips, and the timeline over a bordered box with a
title.

- **`.chip` + `.chip-success/-danger/-warning/-accent/-muted/-violet`** —
  small status pill. `statusChipClass()`/`statusTone()` in `shared.js` map a
  backend status string to the right variant — extend that function, don't
  hardcode a class name against a new status in a render function.
- **`.kpi-tile`** — headline-number tile with a bottom accent line
  (`::after`), used for stats. `.kpi-value` + `.kpi-label` + `.kpi-subtext`.
- **`.operator-rail`** — 4px colored left rail (`--operator-color` custom
  property set inline) + body, used for per-operator fleet rows. This is
  the rail pattern that replaced the old `.gw-card` bordered box.
- **`.data-surface`** — the base panel for a titled section
  (`.surface-header` → `.surface-title` + `.surface-subtitle`, then body).
  This is the closest thing to a "card" left in the system — used
  sparingly, for section containers, not for every individual data row.
- **`.timeline` / `.timeline-item` / `.timeline-marker`** — event stream
  (Activity tab, escalations). Marker color via `.success/.warning/.danger`
  modifier, with a soft `box-shadow` glow using `--pulse-rgb`-style raw
  channels.
- **`table.data-table`** — dense row data (Admin Console's Requests/Audit
  sections). Row-level severity via `.row-accent.warning/.danger/.success/.info`
  (a 3px left bar), not a colored background fill.
- **`.dispatch-badge` + `.dispatch-ok/-err/-pending`** — per-operator
  dispatch status inline badges, built by `renderDispatches()`.
- **`.btn-primary/-secondary/-danger/-ghost/-sm`** — buttons. `.btn-primary`
  is the only gradient fill (`--accent` → `#6fe5ff`); everything else is
  flat or bordered.
- **`.banner` + `.banner-ok/-warn/-danger`** — full-width status banner
  (chain-integrity, connection state).
- **`details.command-fold`** — accordion wrapper for restricted/admin
  tools tucked into Access/Tools sections.
- **`.admin-only`** — utility class, hidden by default, revealed by
  `updateAdminVisibility()` whenever `adminApiKey` is present in
  `localStorage`. Apply this to wrap *any* future admin-only block.

## Token parity with the Android Gateway App

`android-gateway/app`'s `colors.xml` / `values-night/colors.xml` are kept
**hex-for-hex identical** to this file's dark/light tokens (`accent
#3dd7ff`/`#007fa6`, `bg_primary #08111f`/`#edf4fb`, etc. — same names,
underscored instead of hyphenated). This is deliberate: the Gateway App's
embedded Control Center and the web surfaces should look like the same
product. **If you change a color here, change it there too, same commit.**

The Gateway App has **not** yet picked up the structural shift away from
cards (`MaterialCardView`-based `gw-card`/`req-card`/`draft-card` are still
literal bordered cards, not rails/strips) — that's a known, tracked gap, not
an oversight. Don't "fix" it by changing its colors again; the colors are
already right, only the shapes need the same pass the web got.

The **Android Admin App** (`android-gateway/adminapp`) was originally a
distinct "Cybernetic Command" palette (steel-blue `#95cdf8` on near-black
`#111416`, per [`docs/Design/android-admin-stitch/DESIGN.md`](Design/android-admin-stitch/DESIGN.md)).
That diverged enough from the Gateway App that the two phones looked like
different products, so its `colors.xml` and the duplicate constants in
`AdminDesignSystem.Palette` were re-pointed to the same dark tokens as
`android-gateway/app/src/main/res/values-night/colors.xml` (`admin_primary
#3dd7ff`, `admin_bg_root #08111f`, `admin_border #243a57`, etc. — same
values, `admin_`-prefixed names). The drawables in `adminapp/res/drawable/`
(`admin_bg_panel`, `admin_bg_card`, `admin_bg_tab_*`, `admin_bg_kpi`, ...)
were switched from hardcoded hex to `@color/admin_*` references so there's
a single source of truth to keep in sync going forward.

This is a **palette-only** change — the Admin App stays a separate APK
(`system-design-v2.md` §1, "Android admin must be a separate app from
Android gateway/user app"); only the colors converged, not the module
boundary.

## What NOT to reintroduce

- No MD3 purple. If you see `#6750a4`/`#d0bcff` anywhere outside `git log`,
  it's leftover from before the rewrite — replace it with the current
  `--accent` tokens.
- No card-farm layouts on the web (`ui-design-guide-v2.md` §2/§7). Reach for
  `.data-surface` + rails/strips/timeline before reaching for a bordered box
  with a title on every row.
- No top horizontal tab bar on the mobile app — bottom 3-tab nav only. Use
  `.filter-chip` for in-page sub-navigation (see Activity tab).
- No per-user sign-in/sign-up screens on **either** web page. Admin unlock
  is an inline API-key field; this project has no per-user auth (see
  [`telegram-bridge.md`](telegram-bridge.md) for why Telegram, not a web
  login, is the officer-facing channel). `system-design-v2.md` §8 has the
  target session-auth model if/when that changes — it hasn't yet.
- No desktop-wide layout changes to `index.html`'s structure — `admin.html`
  is where desktop-width work belongs.
- No new top-level page for "yet another admin view" — a new admin surface
  is a new section in `admin.html`'s sidebar.
- No duplicated token or helper definitions across `index.html`/`admin.html`
  — anything generic belongs in `theme.css`/`shared.js`.
- Signal strength / battery level on gateway/operator rows are still
  **intentionally omitted** — the Android Gateway App doesn't report them.
  Add the field to `POST /api/gateways/register` and `store.registerGateway()`
  before adding UI for it.

## Source of truth

The live implementation is `public/index.html` + `app.js` (Web Operations
UI), `public/admin.html` + `admin.js` (Web Admin Console), and the shared
`public/theme.css` / `shared.js`. The backend view layer they all read
through is `buildAdminData()` / `buildOpsData()` in `src/app.js`. This doc
describes intent and tokens; if it and the running code ever disagree, the
code wins — update this file to match, don't silently let it drift (see the
note at the top of this file for what happens when that rule gets skipped).
