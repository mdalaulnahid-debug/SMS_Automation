# GD Lost-Phone Watch — Implementation Status (branch-local)

**Branch:** `feature/gd-lost-phone-watch` (isolated from `main`/production —
see this branch's `docs/gd-lost-phone-watch-design.md` for the full Phase 1
locked-scope design this tracks progress against; that doc is the source of
truth for *what* is being built and its scope lock, this doc tracks *how far
along* it is. Note: the design doc on this branch has diverged from `main`'s
copy — it was replaced with the refined, locked-scope Phase 1 spec on
2026-07-06; `main` still has the earlier draft until merge).

This file is intentionally **branch-local** — it documents in-progress,
sometimes-broken WIP state that wouldn't make sense on `main`. It gets
folded into (or replaced by) the final `progress_tracker.md`/`todo.md`
entries at merge time, not before.

**How to pick this work back up in a new session:** `git checkout
feature/gd-lost-phone-watch && git pull`, read this file, then the design
doc (especially the "OUT OF SCOPE" section — do not build those things even
if asked to "improve" the feature), then check `git log main..HEAD` for
what's actually landed vs. still planned. Everything is built and tested on
**localhost only** — never run `scripts/deploy.sh` on this branch.

## Status by component (rollout order per design doc's Testing & rollout section)

| # | Component | Status |
|---|---|---|
| 1 | Unit tests in isolation: `normalizeImei`, baseline-seeding, date/victim-number filtering, tier classification | Not started |
| 2 | Data model + migration (`gd_case`, `gd_watched_imei`, `gd_imei_history`, `gd_hit`, `gd_recheck_log`) | Not started |
| 3 | Guard-clause fixes: `findRecentDuplicateRequest` gd-watch exclusions, `dispatchNext` channel preference — with regression tests | Not started |
| 4 | 24h recheck scheduler with per-IMEI staggering | Not started |
| 5 | Admin console UI (case list/detail, new-case form + image upload, approval screen) | Not started |
| 6 | Telegram DM wiring on hit | Not started |
| 7 | Local end-to-end simulation (fake case, multi-day fake replies, assert hit timing) | Not started |

## Latest update

**2026-07-06** — Branch created off `main` (`368cba4`). Initial design
reviewed and locked in during interview. Design doc then replaced with a
more precise **Phase 1 locked-scope spec** (explicit out-of-scope guardrails,
`PENDING_APPROVAL`/second-reviewer approval gate, `POSSIBLE`/`STRONG` hit
tiers instead of a numeric score, named required fixes to
`findRecentDuplicateRequest`/`dispatchNext`/scheduler staggering, and a
strict 7-step build order). Nothing implemented yet.

## Open questions to resolve during implementation

(none yet — add here as they come up while coding, so they don't get lost
between sessions)
