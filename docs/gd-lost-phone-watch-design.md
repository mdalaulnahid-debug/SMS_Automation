# System Design: GD Lost-Phone Watch — Phase 1 (locked scope)

**Status:** design only, no code written. Not started. To be built and fully
tested on **localhost only** before any VPS deployment is even discussed.
This is the authoritative Phase 1 spec, superseding the earlier draft — locked
scope, not open to expansion without an explicit new decision.

Cross-links: [`SESSION_MEMORY.md`](../SESSION_MEMORY.md) (project orientation) ·
[`architecture.md`](../architecture.md) (current implemented system) ·
[`docs/training-and-matching-rules.md`](training-and-matching-rules.md)
(`IMEI-MS` reply format this design depends on) · [`todo.md`](../todo.md)
(planned-work tracker) · [`progress_tracker.md`](../progress_tracker.md)
(session handoff log) ·
[`docs/gd-lost-phone-watch-STATUS.md`](gd-lost-phone-watch-STATUS.md)
(branch-local implementation progress — `feature/gd-lost-phone-watch` only).

## What this is

A case-scoped lost/stolen phone recovery watch, layered on top of the
existing SMS Automation request/dispatch/reply pipeline (see
`architecture.md`). It lets an authorized admin register a police GD
(General Diary) -linked watch on one or more IMEIs, rechecks all three
operators daily, and privately alerts admins/IO when a watched IMEI shows up
on a new SIM after the GD date.

## Explicitly OUT OF SCOPE for this phase — do not build, suggest, or stub any of

- BTS/LAC/CELL/tower-database joins, location output, or hotspot maps
  (tower data lives in a separate project; not available here).
- Any cross-case correlation, repeat-offender linking, or district-level
  intelligence (this stays a single-case-scoped tool per the original
  design's own non-goal: "not a general surveillance tool").
- Any numeric "lead score" or point-weighted scoring model — use the two
  named tiers below instead, nothing else.
- Anything that touches `scripts/deploy.sh` or the production VPS.

**If asked to "improve" this into any of the above, decline and point back
to this scope lock.**

## Data model (new tables, additive only — do not touch `requests`/`request_dispatches`)

```
gd_case:
  caseId, gdNumber, gdDate, investigatingOfficer, victimKnownNumber,
  gdImagePath, createdBy, createdAt,
  status: PENDING_APPROVAL | WATCHING | CLOSED,
  approvedBy, approvedAt, closedAt, closedBy

gd_watched_imei:
  imeiId, caseId, imei, simSlotLabel (nullable, e.g. "Slot 1"), addedAt

gd_imei_history:
  historyId, imeiId, operator, msisdn, usageDate, firstSeenAt,
  isPreTheftBaseline (bool)

gd_hit:
  hitId, imeiId, msisdn, usageDate, operator, detectedAt, notifiedAt,
  acknowledgedBy, tier: POSSIBLE | STRONG

gd_recheck_log:
  logId, imeiId, operator, attemptedAt, outcome
```

## Workflow

1. Admin submits case (GD number/date, IO, victim number, image, 1+ IMEIs) →
   status `PENDING_APPROVAL`. Not watched yet.
2. A *different* super-admin approves → status `WATCHING`. This is a real
   second-reviewer gate, not a formality — reject if the same user approves
   their own case.
3. On approval: dispatch `IMEI-MS` (`channel: 'gd-watch'`) to all three
   operators for every watched IMEI, batched up to 5 identifiers per SMS
   using the existing multi-identifier batching (already implemented in
   `parser.js` — do not build new batching logic, reuse it).
4. Every reply from this first pass → insert into `gd_imei_history` with
   `isPreTheftBaseline = true`. No hits ever come from this pass, **per
   IMEI, per operator** — baseline status is tracked per (imei, operator),
   not per "first tick," so a slow operator's late-arriving first reply is
   still baseline even if other operators already got their baseline
   earlier.
5. Every 24h thereafter (staggered — see scheduler below), per still-
   `WATCHING` IMEI: dispatch again.
6. On each new reply (processed independently per operator, **not** waiting
   for the other operators to finish — a deliberate divergence from the
   normal `ALL_OPERATORS` finalize-when-terminal path):
   - normalize the IMEI (new `normalizeImei()` — see below) before comparing
   - if `(operator, msisdn, usageDate)` already in `gd_imei_history`: skip
   - else insert into `gd_imei_history` (`isPreTheftBaseline = false`)
   - if `usageDate > gdDate` AND `msisdn !== victimKnownNumber`: this is a hit
7. Hit tiering (no invented numeric weights):
   - **POSSIBLE**: first time this condition fires for this (imei, msisdn) pair
   - **STRONG**: the same new msisdn is confirmed again on a later scheduled
     recheck (i.e. still active days later, not a one-off)
8. Every hit → insert `gd_hit`, DM admins/IO immediately via the existing
   `telegramClient.sendMessage({chatId})` path. Never post to the open group.
9. Case stays `WATCHING` until a super-admin manually closes it (status
   `CLOSED`). Closed cases stop being checked entirely.

## Required fixes to existing code (not new subsystems — targeted edits)

- **`normalizeImei(value)`** in `domain.js`, parallel to `normalizePhoneNumber`:
  strip non-digits; if 15 digits, drop the trailing check digit before
  comparing. Needs its own unit tests (14 vs 15 digit forms of the same
  device must compare equal).
- **`findRecentDuplicateRequest` in `store.js`**: add two guard clauses —
  (a) skip the duplicate check entirely when `input.channel === 'gd-watch'`
      (a recheck must never be blocked by its own predecessor)
  (b) skip matching against an in-flight gd-watch request when the
      incoming request is officer-submitted (a real officer's IMEI-MS must
      never be silently dropped as a "duplicate" of a background watch)
- **`dispatchNext(operator)` in the queue logic**: when choosing the next
  queued request for an operator, prefer any `channel !== 'gd-watch'`
  request over a `channel === 'gd-watch'` one, even if the watch request
  was queued first. Do not build a general priority queue — this one
  preference rule only.
- **Scheduler**: stagger each IMEI's daily recheck across a fixed
  time-of-day offset derived from `imeiId` (e.g. hash into a slot), so a
  batch of cases created together doesn't all come due on the same tick and
  flood the per-operator queues.
- **Per-dispatch reply handling for `channel === 'gd-watch'`**: branch
  BEFORE `_finalizeIfTerminal` is reached — run the diff/detect logic per
  operator reply as it arrives, independent of whether other operators have
  replied. Do not route gd-watch requests through the normal combined-draft
  / `NEEDS_MANUAL_REVIEW` path.

## API surface (admin-auth gated, never reachable from the Telegram group)

- `POST /api/admin/gd-cases` (create, `PENDING_APPROVAL`)
- `POST /api/admin/gd-cases/:id/approve` (super-admin only, not the creator)
- `GET /api/admin/gd-cases` (list: status, GD number, IO, days watching, hit count)
- `GET /api/admin/gd-cases/:id` (detail: IMEIs, history timeline, hits)
- `POST /api/admin/gd-cases/:id/close`
- `GET /api/admin/gd-cases/:id/image` (authenticated retrieval, never a
  static URL — store outside `public/`, validate file type + size cap on
  upload)

## Security (same posture as the rest of the system, nothing new invented)

- Every case create/approve/close/hit/scheduler-tick action goes through the
  existing `audit_logs` hash-chain pattern.
- GD images: outside `public/`, authenticated endpoint only.
- Cap on cases-created-per-day per admin account as a tripwire (log if
  exceeded).

## Testing & rollout order

1. Unit tests first, in isolation, no DB: `normalizeImei`, baseline-seeding
   logic, date-after-GD + victim-number-exclusion filtering, tier
   classification.
2. Then data model + migration.
3. Then the two guard-clause fixes above, with regression tests.
4. Then scheduler with staggering.
5. Then admin console (case list/detail, new-case form with image upload,
   approval screen).
6. Then Telegram DM wiring.
7. Then a local end-to-end simulation: fake case, fake multi-day operator
   replies across all three operators, assert hits fire exactly when
   expected and never on the baseline pass.

Everything built and run on **localhost only**. Do not run
`scripts/deploy.sh` or discuss VPS deployment until this is reviewed and
explicitly approved.
