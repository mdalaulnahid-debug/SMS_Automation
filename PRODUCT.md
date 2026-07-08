# Product

## Register

product

## Users

Two distinct audiences, served by different surfaces of the same backend:

- **Operational users** (existing, majority of the app): police officers,
  admins, and super-admins running the SMS Automation bridge itself —
  submitting subscriber-lookup requests via Telegram, reviewing/approving
  reply drafts, monitoring gateway phone health, and managing the Personnel
  Registry and admin console. Desk-based or on-the-move, time-pressured,
  need clarity and low error tolerance (this is investigative work).
- **Public-tier visitors** (this task's focus): anyone unauthenticated who
  lands on the web root, plus logged-in "Registered Officer" accounts who
  are registry-verified but not admins. Per the access-tier model
  (`docs/security-hardening-v1-design.md` §4), both groups see exactly one
  static informational page — what the system is, its purpose, no
  operational content — plus, for logged-in officers, their own
  account/quota status. This could be a citizen, a family member of an
  officer, or an officer whose real work happens entirely inside Telegram.

## Product Purpose

SMS Automation is a lawful, auditable SMS bridge for LIC Barishal
(Bangladesh Police): authorized officers request subscriber
location/identity information from mobile operators (GP, Robi,
Banglalink) via Telegram, the backend routes the request through
registered gateway phones, and approved replies are posted back with a
full audit trail. The public-tier page exists so the system has a
legitimate, verifiable public face — explaining what it is and why it
exists — without exposing any operational surface to anyone who isn't
authorized to see it. Success for this page specifically: a visitor
understands the system's purpose and legitimacy in one screen, and zero
operational data (queue state, fleet health, request volume) is ever
visible to a non-admin.

## Brand Personality

Authoritative & formal, calm & reassuring, modern & disciplined. This is a
government service page, not a product pitch — trust is earned through
restraint and clarity, not persuasion tactics. Visually it should read as
the public face of the same command-center-grade system the internal app
already is (same teal-on-ink Material-3 tokens), not a bolted-on separate
brand, and explicitly not a dated `.gov.bd`-template look (marquee
notice-boards, tiny thumbnail sliders, cluttered link walls).

## Anti-references

- Dated Bangladesh government portal template: cluttered notice-board
  layout, marquee/ticker text, low-res image sliders, dense unstructured
  link lists.
- SaaS marketing page: gradient hero, "get started free" CTAs, pricing-page
  tropes, consumer-product cheerfulness. This is a police service, not a
  product being sold.
- The internal ops dashboard leaking through: no KPI tiles, fleet status,
  queue counts, or any monitoring surface may appear on this page for any
  unauthenticated or Registered-Officer-tier visitor — that boundary is
  server-enforced (`guardPage`/access-tier model), and the visual design
  must not create any temptation to smuggle operational data in "just this
  once."

## Design Principles

- **One page, zero operational leakage.** The Public/Registered-Officer
  tier is informational only — purpose, legitimacy, and (when logged in)
  personal account status. Never queue data, fleet health, or system
  internals, regardless of how tempting a "quick status widget" seems.
- **Institutional trust over persuasion.** Calm, plain-language explanation
  of what the system does and why it's lawful — no urgency tactics,
  no growth-hacking patterns, no sales language.
- **Command-center visual continuity.** Reuse the same teal/ink Material-3
  tokens (`public/theme.css`) as the internal admin/ops surfaces so the
  public page reads as one disciplined system, not a disconnected brand
  glued onto a tool.
- **Calm authority, not cold bureaucracy.** Formal without being
  intimidating — a citizen or an officer's family member should be able to
  read this page and understand it without specialized knowledge.
- **Practice what you preach.** This page is part of a security-hardening
  initiative — it should itself model good privacy/security posture (clear
  about what is and isn't collected, no dark patterns), not just describe
  a system that does.

## Accessibility & Inclusion

WCAG AA. English only for now (the rest of the app is English-only;
Bengali is a possible fast-follow, not in scope here). Must meet the
existing token system's contrast discipline — body text ≥4.5:1, respect
`prefers-reduced-motion` for any hero/entrance animation.
