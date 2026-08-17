# Vision

## Goal

Build a reliable, auditable SMS automation bridge for lawful operator push-pull requests, while reducing manual copying, wrong routing, and wrong-recipient risks.

## Principles

- Keep operator SMS commands exact and unchanged.
- Never expose backend silent references to operator SMS services.
- Process only trusted sender replies from configured push-pull, hotline, or network numbers.
- Keep one active request per operator phone unless the operator service gives a reliable unique reply reference.
- Preserve requester identity from intake through final tagged reply.
- Require manual review before posting sensitive results to the Telegram group.
- Telegram is the live intake and reply channel; no WhatsApp integration is planned.

## Target Outcome

An authorized user submits a formatted request. The backend routes it safely, sends SMS through the right phone, waits for operator replies, analyzes the reply format using training data, and prepares a tagged response for review.

## Long-Term Direction

- Persistent database with audit protection.
- Android gateway companion app for the three phones (**v1.2.1 shipped; E2E test passed 2026-06-11**).
- Admin dashboard for queues, phone health, logs, and manual review.
- Better extractor rules for `IMEI`, `MSISDN`, `NID`, `IMSI`, location, date, and address fields.
- Telegram bridge handles intake and reply posting (`telegram-bridge/`); see `docs/telegram-bridge.md`.

## Current State (as of 2026-08-17)

Long past MVP — live in production, handling real police-investigation
traffic across all three operators (GP/Robi/Banglalink), with a full
audit-logged request/dispatch/reply pipeline, admin console, and (on the VPS
only, not yet merged back — see below) a real per-officer email+password+MFA
login system replacing the original single shared admin key.

For the current, accurate state of what's built vs. in-progress vs.
deployed, **read `progress_tracker.md`'s most recent session handoff and
`todo.md`'s open items** — this file stays a stable statement of goals and
principles, not a state tracker, and gets stale fast if treated as one (the
"June 2026" MVP snapshot below is kept only as history).

**One standing fact worth knowing before touching anything here:** the
production VPS's own `main` branch has diverged significantly from
`origin/main` (147 commits, plus VPS-only work never pushed until backed up
as `vps-only-backup-20260815`) — don't assume the deployed code matches any
local branch without checking. Full detail in `todo.md`'s CRITICAL entry.

### Historical MVP snapshot (June 2026, kept for reference)

- Test mode works: app Test Request → SMS via gateway phone → manual reply → backend draft with `@requesterName`.
- Telegram chat ID and requester metadata come from the Telegram message; drafts appear on the dashboard for review, then the bridge posts approved replies back to the group.
- Dual-SIM phones need correct default SMS SIM until the app adds a subscription picker.
