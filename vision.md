# Vision

## Goal

Build a reliable, auditable SMS automation bridge for lawful operator push-pull requests, while reducing manual copying, wrong routing, and wrong-recipient risks.

## Principles

- Keep operator SMS commands exact and unchanged.
- Never expose backend silent references to operator SMS services.
- Process only trusted sender replies from configured push-pull, hotline, or network numbers.
- Keep one active request per operator phone unless the operator service gives a reliable unique reply reference.
- Preserve requester identity from intake through final WhatsApp-ready reply.
- Require manual review before posting sensitive results to WhatsApp.
- Prefer official/policy-safe WhatsApp integration when full automation is added.

## Target Outcome

An authorized user submits a formatted request. The backend routes it safely, sends SMS through the right phone, waits for operator replies, analyzes the reply format using training data, and prepares a tagged response for review.

## Long-Term Direction

- Persistent database with audit protection.
- Android gateway companion app for the three phones (**v1.2.1 shipped; E2E test passed 2026-06-11**).
- Admin dashboard for queues, phone health, logs, and manual review.
- Better extractor rules for `IMEI`, `MSISDN`, `NID`, `IMSI`, location, date, and address fields.
- Official WhatsApp intake/reply integration when available (`whatsappGroupId` stored on requests today; posting is manual).

## Current MVP State (June 2026)

- Test mode works: app Test Request → SMS via gateway phone → manual reply → backend draft with `@requesterName`.
- WhatsApp group ID and requester metadata come from app Settings (Test Metadata); drafts appear on PC dashboard only.
- Dual-SIM phones need correct default SMS SIM until the app adds a subscription picker.
