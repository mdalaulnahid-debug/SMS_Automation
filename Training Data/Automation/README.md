# Training Data Organization

This folder now holds the curated manual baseline for reply-shape matching.

## Active source of truth

Use these top-level workbooks as the primary maintained dataset:

- `LCL.xlsx`
- `LRL.xlsx`
- `MS-NID.xlsx`
- `NID-MS.xlsx`
- `IMEI-MS.xlsx`

These files are manually curated and should be edited by humans only.

## Important policy

- do not auto-write new examples into these workbooks
- do not treat old operator-wise folders or zip archives as higher priority than these five files
- if the system captures new real examples, store them separately for review first

Review-only captured examples belong in:

- `data/manual-review/*.json`

Those files are not live training data. They are only for human review before any example is promoted into these curated workbooks.

## Runtime usage

The backend does not use these Excel files directly on every reply.

Instead, run:

```bash
npm run import:training
```

That generates runtime cache files in:

- `data/training-cache/*.json`
- `data/training-summary.json`

## Rule reminder

Initially request handling was treated as a fully hardbound rule. That still applies to the operator-facing SMS body.

What changed is only the intake side:

- safe formatting variations can be normalized before validation
- final outbound operator SMS must still remain canonical and hardbound

## Suggested workbook columns

- `Request`
- `Reply`
- optional operator/source notes if useful

Keep examples clean and correctly labeled by request family, especially:

- `LRL` versus `LCL`
- `MS-NID` versus `NID-MS`
- `IMEI-MS` first echoed IMEI versus later 14-digit/15-digit row variants
