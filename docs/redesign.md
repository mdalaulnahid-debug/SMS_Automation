# React + TypeScript Migration — Vision, Architecture, and Phase Plan

**Status:** Phase 0 and Phase 1/1.5 done and verified on localhost. Phases
2–7 planned below, not started. Nothing deployed; `public/` stays live and
untouched until a full parity pass is signed off (standing rule for this
whole effort).

## Why this exists

The current web front end (`public/*.html` + `*.js`) is vanilla, no build
step, no framework. That's simple, but it means the AI design tooling this
project now has access to (21st.dev Magic MCP — real React/shadcn
components) can't be dropped in directly; everything has to be
hand-translated into vanilla CSS/JS first. This migration removes that
translation tax by moving the front end onto a real component pipeline,
one surface at a time, without ever taking the live product offline or
guessing at a new visual identity.

## Vision: fidelity, not reinvention

This is **not** a rebrand. The product already has a real, deliberate
visual identity — the **ROMER Command Grid** system (dark navy `#081425`,
teal accent `#44e2cd`, Manrope + IBM Plex Mono, Material Symbols icons,
surface-container elevation ramp) — documented in `docs/design-system.md`
and proven across every surface shipped since 2026-07-04. The migration's
job is to carry that identity onto a better substrate faithfully, not to
invent a new one. Every design token in `web/src/index.css` is copied
verbatim from `public/theme.css`, not re-derived (confirmed byte-for-byte
in Phase 0). Any actual visual redesign work (like the Settings dashboard
rebuild in Phase 1.5) is scoped as an explicit, separate decision — flagged
as a redesign because the *information architecture* was wrong (unrelated
domains crammed into one flat grid), not because the *palette* was wrong.

## Architecture decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Language | TypeScript | Type safety across the API contract; matches what shadcn's own components assume |
| Styling | Tailwind CSS v4 | `theme.css` tokens port directly into Tailwind's `@theme` block; is what every Magic MCP component ships with |
| Component primitives | shadcn/ui (`base` library) | The format every Magic MCP search result comes in — using it means fetched components drop in with minimal rework |
| App location | `web/` at repo root | Independent `package.json`, `public/` keeps serving live traffic untouched until cutover (Phase 6) |
| Build tool | Vite | Fast dev server, first-class React+TS template, trivial proxy config to the existing Node backend |
| Backend | **Unchanged** | Every phase reuses the existing `/api/*` contract 1:1 — no new endpoints, no schema changes, ever, for this migration specifically |

## Full phase table

| Phase | Scope | Status |
|---|---|---|
| 0 | Scaffold `web/` (Vite+React+TS+Tailwind+shadcn), port design tokens, dev proxy to `:3000`, one real page (Welcome) built from a fetched Magic MCP component | **Done** |
| 1 | Foundation: typed API client (`lib/api.ts`), auth context (`lib/auth.tsx`), theme provider, `AppShell` layout, router | **Done** |
| 1.5 | Settings dashboard rebuild — the flat "Tools" grid split into 6 named categories (Profile, Telegram Bridge, Personnel Registry, Provisioning, Developer Tools, Release) | **Done** |
| 2 | Auth pages: Login (password → MFA → session, plus step-up re-auth), Register | **Planned below** |
| 3 | Officer Portal port (`portal.html` → React) — smallest real page, first end-to-end proof of role-based routing | **Planned below** |
| 4 | Ops UI port: Home, Activity, About/Contact/Help | Later, not detailed yet |
| 5 | Admin Console port: Overview, Approvals Queue, Unmatched, Rejected, Audit, Phone Inbox, Team | Later, not detailed yet |
| 6 | `src/server.js` serves the built `web/dist` bundle with SPA fallback; `public/` kept for rollback | Later |
| 7 | `deploy.sh` gains a build step; staged VPS deploy after a full parity pass | Later, needs explicit approval (standing rule) |

---

## Phase 2: Auth pages (Login + Register)

### What's being ported

- `public/login.html` (196 lines) — two-step gate: email+password →
  `POST /api/auth/login` (issues `pendingToken` + emails a 6-digit MFA
  code) → code entry → `POST /api/auth/mfa/verify` (issues the real
  session + sets the `HttpOnly` cookie used for server-side page gating).
  Also currently handles the **step-up re-auth** flow
  (`?stepup=1&return=/admin`) added this session for super-admin console
  access.
- `public/register.html` (156 lines) — a single form (`#stepForm`) posting
  to `POST /api/auth/register`, then a confirmation state (`#stepDone`)
  telling the officer to check their email for a verification link.

No backend changes. Both pages already have a stable, tested API contract;
this phase is a faithful UI port plus a few real UX upgrades the React
substrate makes possible for free (below).

### Architecture

- **Standalone pages, no `AppShell`.** Login and Register are the one
  place in the whole app that must never assume a session exists — they
  render outside the sidebar shell entirely, matching today's minimal
  `gate-shell` centered-card pattern. Route table: `/login`, `/register`
  (bare, no nested layout route).
- **Form handling: `react-hook-form` + `zod`, not manual `useState`.**
  Phase 1.5's Settings forms used plain `useState` because they're simple,
  independent fields with no cross-field validation. Login/Register are
  different: multi-step state, password-confirmation-shape validation, MFA
  code format (`^\d{6}$`), and — critically — real error messages that
  must map to specific fields. `zod` schemas double as the single source
  of truth for both client-side validation and TypeScript types for the
  request payloads. New shadcn primitives to add for this phase:
  `form`, `input-otp` (for the 6-digit MFA code — a real, purpose-built
  component instead of a plain text input), fetched via the connected
  21st.dev MCP / shadcn's own registry as needed.
- **Login as a state machine**, not a page swap. Today's
  `#stepPassword`/`#stepMfa` `display:none` toggle becomes explicit React
  state: `type LoginStep = 'password' | 'mfa'`. Same two-step shape, just
  modeled as data instead of DOM visibility.
- **Step-up re-auth becomes a first-class route param, not a full
  reload.** Today: server redirects to `/login.html?stepup=1&return=
  /admin`, a full page navigation. In the React app: a `RequireFreshAuth`
  route guard (new, see below) redirects to `/login?stepup=1` and passes
  the return path via React Router's `location.state`, so completing MFA
  can `navigate(returnTo, { replace: true })` client-side — no full reload,
  same underlying backend freshness check (`session.created_at` within 15
  minutes), zero backend changes.
- **Centralizing role-redirect logic.** Today, "where does this role land
  after login" logic is hand-duplicated in `login.html`, `index.html`,
  `portal.html`, and `admin.html` (four separate copies of similar
  `if (role === ...)` branches). Phase 2 introduces one function,
  `resolveHomeRoute(user)`, in `lib/auth.tsx`, used by Login's post-MFA
  redirect and reused by every later phase's route guards — a real
  consolidation this migration enables, not new speculative abstraction.
- **`RequireAuth` / `RequireRole` route guards** (new,
  `web/src/components/auth/RequireAuth.tsx`) — wrap any route that needs a
  session, calling `GET /api/auth/me` once and redirecting to `/login` on
  failure, exactly mirroring `guardPage()`'s server-side contract but as a
  client-side companion (the server-side gate on `/api/*` endpoints stays
  the real enforcement — this is UX routing, not a security boundary).

### Files (when built)

- New: `web/src/pages/auth/Login.tsx`, `Register.tsx`
- New: `web/src/components/auth/RequireAuth.tsx`, `RequireFreshAuth.tsx`
- New: `web/src/lib/auth.tsx` gains `resolveHomeRoute(user)`
- New shadcn primitives: `form`, `input-otp` (fetched, not hand-rolled)
- `web/src/App.tsx` — add `/login`, `/register` routes

### Verification (when built)

- Full password → MFA → session round trip against the real backend
  (`localhost:3000` via the `/api` proxy), using a temporary test account
  the same way every other phase's live checks have worked this session.
- Step-up flow: age a session past 15 minutes (same DB technique used to
  test the vanilla step-up flow), confirm the client-side redirect
  carries the return path correctly and lands back on the right page
  after MFA.
- `public/login.html`/`register.html` confirmed still live and unchanged.

---

## Phase 3: Officer Portal port

### What's being ported

`public/portal.html` (86 lines) + `public/portal.js` (71 lines) — the
smallest real page in the product: a Telegram-linked officer's entire web
surface. Header (logo + sign-out), a static informational hero, a
Telegram deep-link CTA, an account-status card (`GET /api/auth/me`), and a
footer contact link. Three functions total in the original: `esc`,
`renderAccount`, `portalLogout`.

### Why this phase, right after auth (not Ops UI or Admin)

This is deliberately the **first real page built on top of Phase 2's auth
guards** rather than jumping straight to the much larger Ops UI or Admin
Console. It's small enough to port in one pass, and it's the exact page
that exercises the **role-based routing this migration is supposed to
prove out**: a plain officer with a linked Telegram ID must land here and
see *only* this, nothing else — the same server-enforced boundary
`src/app.js`'s `GET /` handler already draws for the vanilla app. Getting
this right in React, small and reviewable, de-risks Phases 4/5 (which
reuse the identical guard).

### Architecture

- **Standalone page, no `AppShell`.** Matches the vanilla version exactly
  — no sidebar, no tabs. This is intentional and already a deliberate
  security decision from earlier this session (a Telegram-linked officer's
  browser should never even receive admin-shell markup/JS); the React port
  preserves that by routing `/portal` outside the `AppShell` layout route,
  same as `/login` and `/register`.
- **Route guard composition proves the model.** `/portal` is wrapped in
  `RequireAuth` (Phase 2) plus a new, narrow `RequireOfficerRole` check —
  demonstrating that role-specific gates compose cleanly on top of the
  general auth guard, the pattern Phases 4/5 will reuse for
  admin/super_admin-only routes.
- **Data fetching**: a small `useSessionUser()` hook (thin wrapper over
  `GET /api/auth/me` via the Phase 1 API client) replaces `portal.js`'s
  manual `fetch` + `localStorage.setItem('sessionUser', ...)` — same
  network call, same response shape, just consolidated into one reusable
  hook instead of re-implemented per page (Phase 2's Login and Phase 3's
  Portal would otherwise both hand-roll the same fetch).
- **Sign-out reuses `useAuth().logout()`** from Phase 1's auth context —
  zero new logic, `portal.js`'s `portalLogout()` becomes a one-line call.

### Files (when built)

- New: `web/src/pages/Portal.tsx`
- New: `web/src/lib/hooks/useSessionUser.ts`
- New: `web/src/components/auth/RequireOfficerRole.tsx`
- `web/src/App.tsx` — add `/portal` route (guarded, outside `AppShell`)

### Verification (when built)

- A real Telegram-linked officer test session (same throwaway-account
  technique used throughout this session) reaches `/portal` and sees
  correct account data; a non-officer session is redirected away.
- Sign-out actually invalidates the session server-side (`POST
  /api/auth/logout`) and returns to `/login`, not just clears client state.
- `public/portal.html` confirmed still live and unchanged.

---

## What's deliberately not planned yet

Phases 4 (Ops UI) and 5 (Admin Console) are the large remaining ports —
intentionally left at the one-line summary level in the phase table above
until Phases 2–3 are actually built and reviewed. Planning them in detail
now, before the auth/routing foundation they depend on has been proven
against a real page, would be planning ahead of evidence.
