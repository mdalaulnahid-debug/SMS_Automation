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

## Decisions (resolved 2026-07-07)

1. **Second-reviewer approval enforcement — CONFIRMED.** gd-watch
   create/approve endpoints require individual session-token auth (separate
   ID + password per account) — the legacy shared admin API key is rejected
   outright for these endpoints. A new `requireSuperAdmin` check (currently
   nonexistent — `requireAdmin` treats `admin`/`super_admin` identically)
   must be built to gate the approval step specifically.
2. **Who gets DM'd on a hit — CONFIRMED.** The super-admin and other
   explicitly authorized Telegram IDs receive gd-watch hit DMs. This list
   will be manageable later from a super-admin console UI; for Phase 1 the
   underlying mechanism (a notify-list, e.g. a `telegramId` field on admin
   accounts or a small dedicated table) needs to exist so the feature
   functions, even before a dedicated management screen is built — it can
   reasonably be built alongside the admin console UI work in step 5 below.
3. **Multi-IMEI batching — CONFIRMED deferred.** Phase 1 dispatches **one
   IMEI per SMS per watched device only** — no batching. Multi/batch-IMEI
   support is explicitly deferred; the user will provide further training
   on real batched-reply formats before that's revisited. Do not build or
   stub batching logic for gd-watch in Phase 1.
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

**All blocking decisions now resolved. Ready to start implementation
(step 1: unit tests in isolation) once the user gives the go-ahead.**
