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
strict 7-step build order).

**2026-07-06 (later)** — Full codebase-alignment review done before writing
any code (see "Implementation Review Findings" appended to
`docs/gd-lost-phone-watch-design.md`). Confirmed the core reuse plan is
sound (`normalizePhoneNumber`, `findRecentDuplicateRequest`,
`_finalizeIfTerminal`, free-text `channel` column, `audit_logs` hash-chain,
additive SQLite schema all check out against the real code). Found five
real gaps that need a decision before implementation starts — see Open
questions below. **Still nothing implemented.**

## Open questions to resolve before/during implementation

1. **Second-reviewer approval enforcement** — `requireAdmin` doesn't
   distinguish `admin` from `super_admin`, and also accepts the legacy
   shared admin API key (no individual identity at all). Recommendation:
   gd-watch create/approve endpoints require individual session-token auth
   only, reject the shared key outright, plus a new `requireSuperAdmin`
   check. **Needs sign-off.**
2. **Who gets DM'd on a hit** — no existing mapping from a web admin
   account (or even a Telegram `authorizedUsers` entry) to "this person
   should receive gd-watch hit alerts." Needs a new config list or a
   `telegramId` field on admin accounts. **Needs a decision on which.**
3. **Multi-IMEI batching data-attribution risk** — real training-data
   replies show Robi doesn't echo IMEI per history row when multiple rows
   exist under one IMEI header, and GP's sample echoed a mismatched digit
   sequence in a row. No training data exists for a genuinely batched
   multi-IMEI reply from any operator. Recommendation: Phase 1 sends one
   IMEI per SMS per watched device, no batching, despite the original
   spec's "reuse existing batching" instruction, until real batched-reply
   behavior is observed operator-by-operator. **Needs sign-off — this is
   the highest-risk item.**
4. **GD image upload has zero precedent** — no multipart/file-upload
   handling exists anywhere in this codebase (raw `node:http`, no
   framework). Budget this as new engineering surface, not an adaptation.
5. **Dashboard pollution** — `buildAdminData()`'s stats/lists (Approvals
   Queue, today's-request counters, failed/timeout counts) will include
   gd-watch background dispatches unless explicitly filtered by
   `channel !== 'gd-watch'`. Not in the original spec; must be added.

Also one naming correction against the original spec: `dispatchNext` (in
`smsGateway.js`) just drains the queue FIFO — the actual place to add the
"prefer non-gd-watch" preference is `OperatorQueue.nextSendable()` in
`queue.js`, not `dispatchNext` itself.
