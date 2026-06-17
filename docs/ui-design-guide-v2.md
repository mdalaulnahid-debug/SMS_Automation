# UI Design Guide v2

Design direction for turning SMS Automation into a professional product across:

- Web Operations UI
- Web Admin Console
- Android Gateway App
- Android Admin App

This guide exists because the current UI is functional but still reads as
amateur in several places: too boxy, too generic, too utility-first, and not
enough hierarchy or design intent.

## 1. Design Goal

The UI should feel like a serious operations product built by a disciplined
team.

Desired qualities:

- confident
- calm under pressure
- clean information hierarchy
- less “dashboard template”
- more “mission control product”

Avoid:

- generic card farms
- random rounded boxes everywhere
- weak typography
- flat status presentation
- “developer tool” visuals leaking into user-facing screens

## 2. Visual Direction

### Core aesthetic

Use an **operations command center** style:

- dark, ink-rich base surfaces
- precise color accents
- restrained glow/motion
- strong typography
- dense but elegant spacing

Reference mood:

- premium network operations console
- not finance-terminal clutter
- not purple Material demo UI
- not consumer SaaS marketing app

### Shape language

Current problem:

- too many equally rounded rectangles
- every block feels like the same card

Target:

- mix of panel, rail, chip, strip, and status-ring patterns
- sharper geometry in dense admin contexts
- selective rounding, not universal softness

Rule of thumb:

- overview surfaces can have medium-radius panels
- data tables and lists should feel tighter, flatter, more precise
- urgent states should use strips, left rails, badges, and inline markers more than giant cards

## 3. Color System

Move from generic purple-heavy MD3 styling to a more intentional palette.

### Recommended base palette

- `Midnight` background
- `Graphite` elevated surfaces
- `Slate` secondary surfaces
- `Ice` primary text
- `Mist` muted text

### Semantic accents

- `Signal Cyan` for active system/network state
- `Operator Green` for healthy/completed
- `Amber` for pending/review/warning
- `Crimson` for failed/offline/high risk
- `Violet` only as a reserved supporting accent, not the main brand color

### Operator identity accents

Each operator can have a subtle identity color, but use carefully:

- GP
- Robi
- Banglalink

These should appear in:

- dispatch markers
- operator rails
- section labels
- SIM identity indicators

Not as giant saturated backgrounds.

## 4. Typography

Current problem:

- too default
- not enough hierarchy
- labels and content often feel same-weight

Target typography system:

- stronger display style for system status
- compact high-contrast section labels
- monospace only where identifiers/logs truly need it
- deliberate numeric styling for KPIs

Recommendation:

- use one expressive sans for product chrome
- use one monospace for IDs, payloads, logs

If you want a premium look later, consider:

- `Manrope` or `Plus Jakarta Sans` for UI
- `IBM Plex Mono` or `JetBrains Mono` for technical data

## 5. Layout Principles

## Web Operations UI

This should not feel like a tiny admin console squeezed into cards.

It should prioritize:

- gateway health
- pending review count
- critical incidents
- latest activity
- quick action items

Preferred structure:

1. top system banner
2. active incidents / needs attention strip
3. gateway fleet overview
4. pending review queue
5. recent activity

## Web Admin Console

This is the true desktop command center.

Preferred structure:

1. left navigation rail
2. top command/header bar
3. high-level operational summary row
4. focused work area
5. contextual side panel for details/actions when needed

Avoid making every section just another standalone card with a title.

Use:

- split panes
- data tables with strong row states
- side drawers for deep details
- inline command bars

## Android Gateway App

This app should feel robust, simple, and almost appliance-like.

Primary concerns:

- is service running
- which gateway identity is active
- which SIM is active
- backend reachable or not
- what was the last meaningful device event

The home screen should feel like a control surface, not a settings pile.

## Android Admin App

This should feel like a mobile supervisor console:

- inbox for approvals
- gateway fleet health
- alerts
- quick escalations
- audit lookup

Not a copy of the gateway app with more menus.

## 6. Information Hierarchy

The current UI overuses equal-weight boxes.

Replace that with four tiers:

1. **System posture**
   - overall health, incidents, pending work
2. **Critical tasks**
   - approvals, unmatched items, failed dispatches
3. **Operational visibility**
   - gateways, queues, trends, latest actions
4. **Deep admin utilities**
   - provisioning, exports, dev tools, setup

Deep utilities should be visually quieter and more hidden.

## 7. Component Direction

### Use more of these

- command bars
- incident strips
- operator rails
- status rings
- compact data tables
- split panels
- timeline/event stream
- stacked KPI tiles with strong numeric styling

### Use less of these

- repeated generic cards
- giant pill buttons everywhere
- same border radius on every element
- large empty surfaces without hierarchy

## 8. Motion

Motion should be subtle and meaningful.

Good uses:

- service pulse
- status transition fade
- drawer/panel reveal
- row highlight when state changes
- staged page load

Bad uses:

- decorative bounce
- attention-seeking motion on every component
- oversized pulsing glows

## 9. Surface-Specific Guidance

## Web Operations UI

- mobile-friendly but not toy-like
- fewer sections
- stronger urgent-state visibility
- one-tap critical actions

## Web Admin Console

- denser
- more precise
- more “glass, rail, strip, table” and less “card grid”
- use whitespace intentionally

## Android Gateway App

- reduce decorative bulk
- keep service state central
- make backend connectivity and SIM identity cleaner
- present logs as structured event feed, not just text blobs

## Android Admin App

- tab structure should likely be:
  - overview
  - approvals
  - gateways
  - incidents
  - audit

## 10. What Should Change From Current Design System

The current web design system in `docs/design-system.md` is serviceable, but
too tied to:

- Material purple defaults
- card-heavy patterns
- narrow-shell thinking
- admin gating patterns that feel temporary

The next version should:

- redefine tokens around the command-center palette
- reduce universal roundness
- differentiate overview surfaces from data-work surfaces
- introduce operator-aware visual language
- support both web operations and web admin without feeling like the same page in two widths

## 11. Professionalism Checklist

Before approving a UI direction, ask:

- Does this feel like a product, not a prototype?
- Is the most urgent information obvious in 3 seconds?
- Can a non-technical stakeholder trust this visually?
- Would this still look credible on a large monitor and on a phone?
- Are we using intentional hierarchy, or just stacking boxes?

If the answer to the last question is “stacking boxes,” the design is not ready.

## 12. Recommended Next Design Workflow

If you want the UI to level up materially, do this next:

1. Create a visual moodboard and token direction first
2. Redesign the **web admin console** information architecture
3. Redesign the **web operations UI** to be lighter and more purposeful
4. Define **Android admin app** nav and feature scope
5. Refine the **Android gateway app** to be more appliance-like

## 13. If You Want Tooling Help

For visual exploration, the best next tools here are:

- **Figma**
  - best for serious screen/system design exploration
  - recommended if you want polished admin/web/mobile concepts before implementation
- **Canva**
  - useful for quick moodboards, presentation boards, and visual direction summaries

Recommended path:

- use **Figma** for actual product UI concepts
- use **Canva** only if you want a fast board or stakeholder presentation

If you want, the next step can be:

1. a **Figma-ready design brief**
2. a **screen-by-screen redesign plan**
3. three distinct visual directions for the admin console before coding
