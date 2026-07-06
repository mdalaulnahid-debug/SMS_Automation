# Lost/Stolen Phone Recovery Watch — System Design (Planned, `P2`)

**Status:** design only, no code written. Not started. To be built and fully
tested on **localhost only** before any VPS deployment is even discussed.

Cross-links: [`SESSION_MEMORY.md`](../SESSION_MEMORY.md) (project orientation) ·
[`architecture.md`](../architecture.md) (current implemented system) ·
[`docs/training-and-matching-rules.md`](training-and-matching-rules.md)
(`IMEI-MS` reply format this design depends on) · [`todo.md`](../todo.md)
(planned-work tracker) · [`progress_tracker.md`](../progress_tracker.md)
(session handoff log).

## 1. Goals & non-goals

**Goals**

- Let an authorized admin register a GD ([General Diary](https://en.wikipedia.org/wiki/General_diary),
  the Bangladesh Police incident-record entry) -linked "watch" on one or more
  stolen/lost phone IMEIs.
- Automatically re-query all three operators for each watched IMEI once daily.
- Detect when a *new* (number, date) pairing appears for a watched IMEI, dated
  after the GD date, that isn't the victim's own known number.
- Privately notify admins/the Investigating Officer of a hit, with enough
  context to act.
- Keep a durable, auditable trail: who opened the case, what evidence (GD
  image) backs it, every check performed, every hit found.

**Non-goals (this phase)**

- Not a general surveillance tool — it only watches IMEIs explicitly
  registered against a real GD case by an authorized user.
- Not real-time (24h cadence, not instant-on-power-up detection).
- Not geolocation/triangulation — it only reads what `IMEI-MS` already
  returns (number + date), the same data the existing system already parses.

## 2. Where this sits in the existing architecture

The critical design decision: **this feature is a thin layer on top of the
existing request/dispatch/reply engine** (see `architecture.md` §3–§10), **not
a parallel system.** The backend already has a mature, tested pipeline —
validate → dispatch to gateway phones → phone sends SMS → operator SMS reply
comes back → reply gets matched to the pending dispatch → analyzed. Reusing it
means the new code is almost entirely about *what happens with a reply*, not
*how a reply gets there*.

Concretely: a scheduled recheck creates a request internally tagged with a new
`channel: 'gd-watch'` (alongside the existing `telegram` / `manual` channels),
targeting `ALL_OPERATORS` exactly like a normal `IMEI-MS` request. It flows
through the same gateway job queue, the same phone polling/delivery, the same
`sms_inbox` capture and reply-matching logic already hardened by recent
session work (duplicate-blocking fix, content-gate cross-match fix). What's
new is bolted on at the two ends: how the request gets *created* (a scheduler,
not a human typing a command) and what happens when a reply gets *matched*
(diff-and-detect, not draft-a-reply-and-post-to-Telegram).

```
┌─────────────┐   daily tick    ┌───────────────────┐
│ GD watch    │ ───────────────▶│ create IMEI-MS     │
│ scheduler   │                 │ request (gd-watch  │──┐
└─────────────┘                 │ channel, fan-out)   │  │
                                 └───────────────────┘  │
                                                          ▼
                                          existing dispatch/queue/gateway
                                          job delivery pipeline (unchanged)
                                                          │
                                                          ▼
                                          operator SMS reply → sms_inbox →
                                          existing reply-matching (unchanged)
                                                          │
                          channel === 'gd-watch'?         │
                                    yes ─────────────────┘
                                    │
                                    ▼
                       ┌─────────────────────────┐
                       │ diff against gd_imei_    │
                       │ history → new hit?       │
                       └─────────────────────────┘
                                    │ yes
                                    ▼
                       ┌─────────────────────────┐
                       │ record gd_hit, DM admins │
                       │ via existing Telegram    │
                       │ bridge send path         │
                       └─────────────────────────┘
```

**Important divergence from normal request handling:** a normal
`ALL_OPERATORS` fan-out waits until every operator's dispatch is terminal
before finalizing (so a combined reply can be posted). A `gd-watch` request
should **not** wait — each operator's reply gets diffed and processed the
moment it arrives, since a hit from one operator shouldn't sit unnotified for
hours while waiting on a slower operator's reply.

## 3. Data model

New tables/entities, deliberately separate from `requests`/`request_dispatches`
(architecture.md §5), which stay untouched:

| Table | Purpose | Key fields |
|---|---|---|
| `gd_case` | One row per GD entry | `caseId`, `gdNumber`, `gdDate`, `investigatingOfficer`, `gdImagePath`, `createdBy`, `createdAt`, `status` (`WATCHING`/`CLOSED`), `closedAt`, `closedBy` |
| `gd_watched_imei` | Devices under a case (many per case) | `imeiId`, `caseId`, `imei`, `victimKnownNumber`, `addedAt` |
| `gd_imei_history` | Every distinct (operator, number, date) ever observed for a watched IMEI | `historyId`, `imeiId`, `operator`, `msisdn`, `usageDate`, `firstSeenAt`, `isPreTheftBaseline` |
| `gd_hit` | A confirmed detection event | `hitId`, `imeiId`, `msisdn`, `usageDate`, `operator`, `detectedAt`, `notifiedAt`, `acknowledgedBy` |
| `gd_recheck_log` | Audit trail of every scheduled recheck attempt (success/failure per operator) | `logId`, `imeiId`, `operator`, `attemptedAt`, `outcome` |

`isPreTheftBaseline` is the single most important flag in the whole design:
the very first check after a case is opened must seed history *without*
generating hits — otherwise the victim's own last-known number would
immediately fire as a false "hit" the moment the case is created.

## 4. Detection algorithm (step by step)

1. Case created → immediately dispatch an `IMEI-MS` (`gd-watch` channel) to
   all three operators for each listed IMEI.
2. Every row returned gets inserted into `gd_imei_history` with
   `isPreTheftBaseline = true`. No hits are ever raised from this first pass.
3. Every 24h thereafter, per watched IMEI still under a `WATCHING` case:
   dispatch again.
4. For each row in a new reply:
   - Normalize the IMEI (the last digit is a check digit only — 14 vs
     15-digit forms of the same device are the same device; see
     `docs/training-and-matching-rules.md` § IMEI-MS).
   - If `(operator, msisdn, usageDate)` already exists in `gd_imei_history` →
     skip, nothing new.
   - Else insert into `gd_imei_history` with `isPreTheftBaseline = false`.
   - If additionally `usageDate > gdDate` AND `msisdn !== victimKnownNumber` →
     this is a `gd_hit`.
5. Every `gd_hit` triggers a DM to authorized admins immediately (not batched,
   not waiting for other operators).
6. Case stays `WATCHING` indefinitely until an admin manually closes it (does
   not auto-pause after a hit — the phone isn't physically recovered just
   because a number was found).

## 5. API surface (conceptual — no implementation yet)

All under existing admin auth (`isAdmin`), never exposed to the open Telegram
group flow:

- `POST /api/admin/gd-cases` — create a case (GD number, date, IO, victim
  number, IMEI list) + image upload (web console form only)
- `GET /api/admin/gd-cases` — list cases (status, GD number, IO, days
  watching, hit count)
- `GET /api/admin/gd-cases/:id` — case detail (IMEIs, full history timeline,
  hits)
- `POST /api/admin/gd-cases/:id/close` — mark closed
- `GET /api/admin/gd-cases/:id/image` — authenticated image retrieval (never
  a raw static URL)

## 6. Scheduler design

A background interval, structurally similar to the existing timeout-sweep
already in `store.js`: on each tick (e.g. every hour), scan
`gd_watched_imei` joined to `gd_case` where `status = 'WATCHING'` and
`lastCheckedAt` is more than 24h old (or null), and dispatch a recheck for
each. This piggybacks on the backend process already running — no separate
service needed. Every attempt (including failures — operator gateway offline,
no reply within the window, etc.) gets written to `gd_recheck_log` so a
silently-stalled watch is visible and auditable, not a silent gap.

**Interaction with existing duplicate-blocking safety net:** the current
system has `findRecentDuplicateRequest` / `DUPLICATE_BLOCKING_STATUSES`
specifically to *stop* accidental repeat requests (this exact mechanism was
hardened this session — see the 2026-07-05 blackout incident in `todo.md`).
This feature deliberately *wants* repeats every 24h, so `gd-watch` dispatches
must be excluded from — and excluded from triggering — that guard, which
exists for human-submitted requests, not scheduled watch rechecks.

## 7. Security architecture

- Case creation/viewing/closing: admin-auth gated, full stop — never
  reachable via the group or an unauthenticated DM.
- GD images: stored outside `public/`, served only through the authenticated
  image endpoint; validated for file type (image/PDF allowlist) and size cap
  on upload.
- Every scheduler dispatch, every hit, every case lifecycle change:
  audit-logged in the existing `audit_logs` pattern.
- `gd-watch` channel requests are explicitly excluded from — and excluded
  from triggering — the existing human-request duplicate-blocking logic.
- Sensible cap on cases-per-day per admin account, logged if exceeded, as a
  tripwire against a compromised admin account spinning up mass watches.
- Framed honestly as "rigorously tested and hardened," not "100% secure" —
  no real system can make that claim truthfully.

## 8. Edge cases to design against

- **Same IMEI watched by two separate GD cases** (rare but possible —
  duplicate reports): warn on case creation if the IMEI is already under an
  active watch elsewhere, rather than silently double-tracking it.
- **Legitimate resale after case closure**: once a case is `CLOSED`, its
  history stops being checked — a phone resold after legitimate recovery
  shouldn't keep generating hits.
- **Operator returns "No data found" forever**: not an error, just means the
  phone hasn't been used on that network — `gd_recheck_log` should
  distinguish this from an actual failed/undelivered check.
- **Check-digit 14-vs-15 digit IMEI variants**: must normalize before
  comparing across operators/replies, or the same physical device could be
  misread as two different IMEIs.

## 9. Testing & rollout plan

- Unit tests for the diff/detection algorithm in isolation (baseline
  seeding, check-digit normalization, date-after-GD filtering,
  victim-number exclusion) — highest-risk-of-subtle-bugs part, easiest to
  test without infrastructure.
- Local end-to-end simulation: fake case, fake multi-day operator replies,
  assert hits fire exactly when expected and never on the baseline pass.
- Entirely built and exercised on **localhost first**. Nothing touches the
  VPS until reviewed and explicitly approved for deployment.

## 10. Key decisions already made (2026-07-06 design interview)

| Decision | Choice |
|---|---|
| Detection trigger | New (number, date) after the GD date, excluding the victim's known number |
| Notification target | DM to admins/IO only (not the open group) |
| Recheck interval | Once every 24h per watched IMEI |
| Case scope | One GD case can list several IMEIs |
| Who can create a case | Admins/authorized users only |
| GD image upload | Web admin console upload form only |
| Post-hit behavior | Case stays `WATCHING` until an admin manually closes it |

**Not yet started.** Next step, when ready to build: confirm this design
still holds, then implement and test entirely on localhost per the plan
above before any deployment conversation.
