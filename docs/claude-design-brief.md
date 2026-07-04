# SMS Automation — Design Brief (for Claude Design import)

Self-contained design summary of the live web UI (`public/index.html`,
`public/admin.html`, `public/theme.css`). Generated from the actual running
code, not aspirational — if this ever disagrees with `public/theme.css`,
the code is correct. This file exists so the visual system can be handed to
a design tool without re-deriving it from source; the maintained narrative
doc for engineers is [`design-system.md`](design-system.md).

> **2026-07-04 update — implemented and reskinned.** This brief was the input
> to Claude Design; the result shipped and the palette then moved to a
> **Material-3 "ROMER Command Grid"** system: a **teal** interactive accent
> (`--accent #44e2cd` dark / `#0f766e` light) over a surface-container
> elevation ramp, softer shadows, plus a restructured **Approvals Queue**
> admin (master-detail with Pending/Resolved/Archived tabs) and animated
> **heartbeat** gateway-fleet cards. The token table in §4 has been updated to
> the shipped teal values; `public/theme.css` remains the source of truth.

## 1. What this product is

A police-investigation SMS bridge. Officers request subscriber
location/info via Telegram commands; the backend routes the request to an
Android gateway phone tied to a mobile operator (GP / ROBI / BANGLALINK),
which sends the SMS and forwards the operator's reply back. A reviewer
approves the reply, then it's posted back to the officer on Telegram.

The web UI is the **operator/reviewer surface** — monitoring gateway
health, SMS traffic, and approving reply drafts. It is not the
officer-facing surface (that's Telegram), so it never needed marketing
polish — it needed to read like an operations console a reviewer trusts at
a glance.

## 2. Design philosophy — "Control Room, Not Marketing Site"

- **Legitimacy over decoration.** This is evidence-adjacent tooling used by
  law enforcement reviewers. Every visual choice should read as precise and
  auditable, not consumer-playful. No illustration, no marketing copy tone.
- **Calm density, not sparse whitespace.** Reviewers scan many rows/events
  per session. Favor compact, scannable rows (rails, strips, timeline
  entries) over generous card padding and big empty margins.
- **Color as status language, not brand decoration.** Success/warning/danger
  are the only saturated colors that carry meaning; everything else stays
  desaturated slate/navy so the status colors pop when something needs
  attention. See §4 — color is functional first.
- **Dark by default.** `:root` is the dark palette; light mode is the
  override, not the default (this flipped from an earlier MD3 light-first
  version — see `design-system.md`'s changelog note).
- **Two audiences, two surfaces, one token set.** A phone-width "Operations"
  view (quick glance, bottom nav) and a desktop-width "Admin Console" (dense
  tables, sidebar) share the same color/typography/component tokens so they
  read as one product, not two.

## 3. Typography

| Role | Family | Notes |
|---|---|---|
| UI text | **Manrope** (weights 500/700/800) | Loaded via Google Fonts CDN, no build step |
| Monospace | **IBM Plex Mono** (weights 400/500/600) | IDs, payloads, logs, timestamps — anything that benefits from tabular alignment |
| Icons | **Material Symbols Outlined** (opsz 24, wght 500, FILL 0, GRAD 0) | Single icon set throughout, outline style only |

Base font size `14px` (`html { font-size: 14px }`), scaling up via explicit
`font-size` per component rather than a global type-scale variable.

Icons currently in use: `apartment`, `call`, `chat`, `help`, `info`, `key`,
`logout`, `mail`, `qr_code_2`, `radar`, `search`, `send`, `timeline`, `tune`
— plus standard nav glyphs (home/activity/settings). All Material Symbols
Outlined, never emoji.

## 4. Color tokens

Dark is the default (`:root`); light is `[data-theme="light"]`.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg-page` | `#081425` | `#f5f7fa` | Page background base (plus radial-gradient wash) |
| `--bg-page-alt` | `#040e1f` | `#eceef2` | Gradient end stop |
| `--bg-surface` | `rgba(17,28,45,.92)` | `rgba(255,255,255,.92)` | Header, frosted via `backdrop-filter: blur(18px)` |
| `--bg-panel` | `#152031` | `#ffffff` | `.data-surface`, `.kpi-tile`, `.timeline-item` (M3 surface-container) |
| `--bg-panel-2` | `#1f2a3c` | `#f2f4f7` | Inputs, table toolbar, secondary buttons |
| `--bg-panel-soft` | `rgba(18,30,49,.72)` | `rgba(244,248,252,.84)` | `.icon-btn` resting state |
| `--bg-overlay` | `rgba(4,10,20,.72)` | `rgba(14,24,42,.24)` | Auth gate backdrop |
| `--bg-chrome-header` | `rgba(8,17,31,.88)` | `rgba(255,255,255,.88)` | Sticky header chrome |
| `--bg-chrome-nav` | `rgba(8,17,31,.92)` | `rgba(255,255,255,.92)` | Bottom nav (mobile) |
| `--bg-chrome-sidebar` | `rgba(8,17,31,.55)` | `rgba(255,255,255,.55)` | Desktop sidebar |
| `--text-primary` | `#d8e3fb` | `#191c1e` | Headings, primary text |
| `--text-secondary` | `#aab6cf` | `#434654` | Body text |
| `--text-muted` | `#808da7` | `#6b6f7e` | Meta, timestamps, labels |
| `--divider` / `--divider-strong` | `rgba(133,160,200,.16)` / `.30` | `rgba(115,118,133,.18)` / `.30` | Borders |
| `--accent` | `#44e2cd` (teal) | `#0f766e` (deep teal) | Brand, focus rings, active nav, primary buttons |
| `--accent-2` | `#bec6e0` (silver-lavender) | `#003d9b` | Secondary accent |
| `--accent-on` | `#003029` | `#ffffff` | Text on accent-filled surfaces |
| `--accent-bg` / `--accent-border` | `rgba(68,226,205,.12)` / `.34` | `rgba(15,118,110,.10)` / `.28` | Accent chip backgrounds/borders |
| `--brand-navy` | `#04014b` | — | Insignia/brand navy, preserved through the reskin |
| `--success` / `--success-bg` | `#56d88b` / `rgba(86,216,139,.14)` | `#1f9d59` / `rgba(31,157,89,.12)` | Online, completed, sent-ok |
| `--warning` / `--warning-bg` | `#ffbf5f` / `rgba(255,191,95,.14)` | `#b57000` / `rgba(181,112,0,.12)` | Needs review, pending |
| `--danger` / `--danger-bg` | `#ff6d7f` / `rgba(255,109,127,.14)` | `#cf3752` / `rgba(207,55,82,.12)` | Offline, failed, error |
| `--violet` / `--violet-bg` | `#9d8cff` / `rgba(157,140,255,.12)` | `#6559d8` / `rgba(101,89,216,.1)` | Reserved supporting accent, not a primary brand color |
| `--operator-gp` / `--operator-robi` / `--operator-banglalink` | `#5ad678` / `#ff7997` / `#ffaf59` | *(dark only)* | Operator identity rails |
| `--shadow-md` / `--shadow-lg` | dark-tuned | light-tuned | Elevation on `.glass-panel`/`.data-surface` |
| `--radius-sm` / `--radius-md` / `--radius-lg` | `10px` / `16px` / `22px` | same | Shared corner radii |

**Rule:** color only carries meaning where it's functional (success/warning/
danger). Everything else — chrome, panels, dividers — stays desaturated
slate/navy. Never introduce a new saturated color for decoration.

## 5. Layout system

Two responsive shells sharing one token set, switching at **`900px`**:

- **Mobile / narrow (`<900px`)** — single-column phone shell,
  `max-width: 480px`, centered, fixed bottom nav (3 items: Home / Activity /
  Access), tab content stacked top-to-bottom.
- **Desktop (`≥900px`)** — full-width sidebar shell (`.desktop-shell`,
  `grid-template-columns: 248px minmax(0,1fr)`), left nav rail
  (`.ops-sidebar`) replaces bottom nav, `main` gets real padding
  (`28px 32px`, `max-width: 1400px`) instead of a centered phone column.

Within the desktop shell, two tabs use a further two-column "monitoring
console" pattern (sticky left rail + scrollable right pane), not stacked
cards:

- **Activity tab** → `.monitor-shell` = `300px` sticky status rail
  (Posture banner, Fleet Status, Needs Attention) + flexible-width Activity
  Console (search, severity filter chips, live timeline).
- **Settings/Access tab** → `.settings-shell` = `220px` sticky grouped nav
  (General / Access / Provisioning) + a single active content group,
  crossfading on switch — reuses the same sidebar-item visual language as
  the outer `.ops-sidebar`.

**Grid safety rule:** any `display:grid` container used as a fixed-width
column must set `grid-template-columns: minmax(0, 1fr)` (never bare `1fr`
or omit the property) — grid items otherwise size to their content's
min-content width and blow out of a fixed track. This bit us twice in this
project (Activity/Settings overlap bugs); it's the one hard layout
constraint worth carrying into a new design tool.

## 6. Component patterns

Shape language deliberately avoids "card farms" — prefer rails, strips, and
timeline rows over a bordered box with a title on every row.

| Component | Shape | Use |
|---|---|---|
| `.chip` (+ `-success/-danger/-warning/-accent/-muted/-violet`) | Small pill, uppercase, 10px | Status label |
| `.kpi-tile` | Panel with bottom accent line (`::after` gradient) | Headline number + label |
| `.operator-rail` | 4px colored left rail + body (`--operator-color` inline) | Per-operator fleet row |
| `.data-surface` | Titled panel: `.surface-header` (title + subtitle) → body | Section container — the only true "card," used sparingly |
| `.timeline` / `.timeline-item` / `.timeline-marker` | Dot marker + title/meta/time row | Event stream (Activity tab) |
| `table.data-table` | Dense rows, severity via 3px left `.row-accent` bar, not fill | Admin Console tabular data |
| `.dispatch-badge` (+ `-ok/-err/-pending`) | Inline pill | Per-operator dispatch status |
| `.btn-primary/-secondary/-danger/-ghost/-sm` | Flat/bordered; primary is the only gradient fill | Actions |
| `.banner` (+ `-ok/-warn/-danger`) | Full-width status strip | Connection/chain-integrity state |
| `.settings-nav-item` / `.ops-sidebar-item` | Icon + label, active = accent-tinted background | Sidebar/settings navigation |

## 7. Motion

All durations 150–250ms, `ease`, and every animation respects
`prefers-reduced-motion: reduce` (disabled entirely, not just shortened):

- Tab/panel switches: fade + 4px translateY (`panel-fade-in`, 0.2s).
- Timeline entries: staggered entrance on refresh (~30ms/item, capped),
  opacity + 6px translateY.
- Sidebar/nav/chip hover: background/border/color transition (0.18s) +
  1–2px translate lift, not an instant snap.
- Status pulse dot: `pulse-ring` box-shadow keyframe, 2s ease-in-out loop,
  used for "live" indicators (header status, gateway ECG line).
- Gateway health line (`gateway-ecg`): animated stroke-dashoffset "ECG
  travel," speed varies by state (online fast / delayed slow / offline
  static).

## 8. What to preserve if reimplementing this in a new tool

- Dark-first, functional-color-only palette — don't add decorative
  saturated colors.
- No cards-everywhere — rails/strips/timeline are the default shape.
- Bottom-nav on mobile (3 items max), sidebar on desktop — never a top
  horizontal tab bar.
- Single icon language: Material Symbols Outlined, no emoji, no mixed sets.
- Motion is functional (state change, live status) not decorative, and
  always has a reduced-motion off-switch.
