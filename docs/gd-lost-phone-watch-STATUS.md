# GD Lost-Phone Watch — Implementation Status (branch-local)

**Branch:** `feature/gd-lost-phone-watch` (isolated from `main`/production —
see `main`'s `docs/gd-lost-phone-watch-design.md` for the full design/plan
this tracks progress against; that doc is the source of truth for *what* is
being built, this doc tracks *how far along* it is).

This file is intentionally **branch-local** — it documents in-progress,
sometimes-broken WIP state that wouldn't make sense on `main`. It gets
folded into (or replaced by) the final `progress_tracker.md`/`todo.md`
entries at merge time, not before.

**How to pick this work back up in a new session:** `git checkout
feature/gd-lost-phone-watch && git pull`, read this file, then the design
doc, then check `git log main..HEAD` for what's actually landed vs. still
planned. Everything is built and tested on **localhost only** — never run
`scripts/deploy.sh` on this branch.

## Status by component

| Component | Status |
|---|---|
| Data model (`gd_case`, `gd_watched_imei`, `gd_imei_history`, `gd_hit`, `gd_recheck_log`) | Not started |
| `gd-watch` channel dispatch + duplicate-blocking exclusion | Not started |
| Detection/diff algorithm + unit tests | Not started |
| 24h recheck scheduler | Not started |
| Admin console UI (case list/detail, new-case form, image upload) | Not started |
| DM notification on hit | Not started |
| Local end-to-end simulation | Not started |

## Latest update

**2026-07-06** — Branch created off `main` (`368cba4`). Design fully
reviewed and locked in (see design doc §10 for the interview decisions).
Nothing implemented yet.

## Open questions to resolve during implementation

(none yet — add here as they come up while coding, so they don't get lost
between sessions)
