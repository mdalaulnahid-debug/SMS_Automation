# Officer Dashboard Design — the plain/regular user's web page

> **Status: design brief only, nothing built.** Written 2026-07-14, following
> the security-hardening-v1 follow-on that gave Telegram-linked officers a
> genuinely separate page (`public/portal.html` + `public/portal.js`) instead
> of the admin app with tabs hidden. That change fixed *access* — this doc is
> about making the page they now land on feel like a real, considered part of
> the product instead of the bare-minimum placeholder it currently is.

## Who this is for

The **plain/regular officer** — `role: officer`, Telegram-linked. Not admin,
not super_admin. Their real working surface is Telegram (submit a request,
get a reply); the web page is secondary — checked occasionally to confirm
their account is active, or the first thing they see if they're curious
enough to visit the URL. It should reward that curiosity with something that
looks like a serious product, not punish it with a blank status card.

## The one rule that must not be violated

**Rich visuals, zero new data surface.** Everything below is about *how the
existing information looks and moves*, never about *adding operational data*
an officer isn't already cleared to see. No fleet status, no other officers'
activity, no request-level detail beyond their own account. This is the same
boundary `docs/security-hardening-v1-design.md` §4 draws for this tier —
this doc works entirely inside it. If a future idea needs new data, it needs
a separate access-tier discussion first, not a design decision here.

One narrow, already-safe exception worth considering: **the officer's own
request *count/streak*, if the backend already tracks it per-`requesterId`**
(worth checking `src/quota.js`'s `QuotaTracker` — it already keeps a
per-officer request history for the quota window). A "your activity" number
drawn from data already scoped to *them* doesn't cross the boundary; showing
*other* officers' numbers, or system-wide volume, would.

## Current state (what exists today)

`public/portal.html` + `public/portal.js`, ~90 lines total:

- Header: insignia logo, brand text, sign-out icon button.
- A static headline/subhead ("A lawful, auditable bridge...").
- One CTA button: "Message the bot on Telegram."
- An account card: name, designation, unit, email, phone, Telegram-linked
  status, an active/pending-review chip.
- A footer "Contact administration" mailto link.

It reuses `theme.css` tokens correctly (no new palette), but has **no theme
toggle** (index.html/admin.html both have one — this is a gap), **no
animation at all**, and reads as a form, not a dashboard.

## Visual direction

**Reuse the ROMER Command Grid system wholesale — do not invent a new look.**
Same dark ink-rich surfaces, same teal accent (`--accent`), same
`glass-panel`/`data-surface`/`chip` component classes already defined in
`theme.css`. The goal isn't a different aesthetic for officers; it's the
*same* professional aesthetic admins get, applied to a smaller page. A
visibly "lesser" design for the officer tier would read as a demotion, which
undermines the message that Telegram is genuinely where the real work
happens — this page should feel like a clean cockpit readout, not a
consolation screen.

Reference: `docs/ui-design-guide-v2.md` §1–2 (the "operations command
center" mood — confident, calm, dense but elegant) and `docs/design-system.md`
§"Color tokens" for the exact token names to bind to.

## Theme support

Add the same dark/light toggle `index.html` and `admin.html` already have
(`data-theme` attribute + the existing `[data-theme="light"]` token block in
`theme.css` — no new tokens needed, just wiring the toggle control and
persisting the choice the same way the other two pages do). This is a real
gap today, not a nice-to-have — every other page in the product has it.

## Content/layout proposal

Keep it a **single column, no tabs** — this page has one job. Structure,
top to bottom:

1. **Hero band** — insignia, greeting using the officer's actual name
   ("Welcome back, SI Rahman" rather than the generic headline that's there
   now), unit/designation as a subline. Personalization is cheap here (the
   data's already loaded) and does a lot to make the page feel *theirs*.
2. **Status ring or badge** — the account status chip (active/pending
   review), but rendered as a more considered element: a small circular
   status indicator with a soft pulse when active (reusing the existing
   `pulse-ring` keyframe pattern from `index.html`'s posture badge — same
   motion language, not a new one), or a static muted state when pending.
3. **Primary CTA** — "Message the bot on Telegram," kept prominent, as it is
   today. This is the single most important action on the page.
4. **Account detail card** — the existing name/designation/unit/email/
   phone/Telegram-linked grid, kept, but consider a light entrance stagger
   (see Animation below) so it doesn't just snap into view.
5. **Optional: "Your activity" strip** — request count within the current
   quota window (if pulled from `QuotaTracker`, subject to the boundary
   check above), presented as a small stat, not a chart — this isn't a
   monitoring surface, just a personal confirmation the account is being
   used.
6. **Footer** — contact link, kept.

## Animation

Per this project's own motion guidelines (150–300ms, transform/opacity only,
`prefers-reduced-motion` always respected — matching the pattern already
used for `.gateway-ecg path` and `panel-fade-in` in `index.html`):

- **Page entrance**: hero band fades/slides in first, then the status
  element, then the account card — a short stagger (~40–60ms between each),
  not a simultaneous pop. Reuse the existing `timeline-in-anim`/
  `panel-fade-in` keyframe shapes rather than inventing new easing curves.
- **Status pulse**: only while `status === 'active'` — a slow (2.4s,
  matching the existing `pulse-ring` timing), low-amplitude glow. A
  `pending_approval` state should look deliberately calmer (no pulse), so
  the animation itself communicates state, not just the color.
- **Telegram CTA**: a subtle hover lift/glow (matches `.icon-btn:hover`'s
  existing `translateY(-1px)` pattern in `theme.css`) — no new interaction
  language, just applying what's already there.
- **Theme toggle**: crossfade the token swap the same way the other two
  pages already do (no special-casing needed, `theme.css` handles this via
  CSS variables already).
- Explicitly **avoid**: looping background animation, parallax, anything
  that runs continuously and competes for attention — this is a status page
  someone glances at, not a hero landing page.

## Non-goals (explicit, so scope doesn't creep back)

- No admin/monitoring data of any kind, even summarized or read-only.
- No list of other officers, gateways, or system-wide activity.
- No new API endpoints beyond what `portal.js` already calls
  (`/api/auth/me`) unless the "Your activity" strip is approved, in which
  case it should read from data already scoped to `requesterId`, nothing
  broader.
- No tabs/navigation — if this page ever needs more than one screen, that's
  a sign the access tier itself needs revisiting, not that this page should
  grow a nav.

## Suggested build order (when this is picked up)

1. Theme toggle (smallest, self-contained, closes an existing gap).
2. Personalized hero + status-ring/pulse treatment.
3. Entrance stagger animation.
4. "Your activity" strip — only after confirming with the user whether
   per-officer request-count data should be surfaced at all, and whether
   `QuotaTracker` is the right/only source for it.

Not scoped here: any change to what data the *backend* exposes. This doc is
presentation-only against data `public/portal.js` already has access to
(plus the one flagged, not-yet-approved addition above).
