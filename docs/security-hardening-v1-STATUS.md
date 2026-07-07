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
| 2 | Server-side page gating (4-tier) | Not started |
| 3 | `telegramId` + identity unification | Not started |
| 4 | Personnel Registry data model + admin-upload loading | Not started |
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

## Open questions / notes found while implementing

(add here as they come up, so they don't get lost between sessions)
