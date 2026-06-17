# Android Admin Stitch

This folder contains the Google Stitch handoff package for the Android admin app redesign.

Use it as a design reference for future Android admin UI passes, not as direct copy-paste code.

## Contents

- `README.md`: package summary and file map
- `DESIGN.md`: design brief exported from the earlier Stitch / concept pass
- `overview.png`: overview / command-center landing screen
- `approvals.png`: approvals inbox concept
- `gateways.png`: gateway fleet health concept
- `incidents.png`: incident response feed concept
- `audit.png`: audit ledger concept
- `system.png`: temporary placeholder image for the broader system / design-system view
- `stitch-export/`: raw exported HTML and notes from the Stitch exploration
  - `overview-code.html`
  - `approvals-code.html`
  - `gateways-code.html`
  - `incidents-code.html`
  - `audit-code.html`
  - `cybernetic-command-design-system.md`

## Notes

- The normalized handoff path is `docs/design/android-admin-stitch/`.
- On this Windows workstation, Git currently recognizes the staged folder under `docs/Design/android-admin-stitch/`.
- `system.png` is currently a placeholder copied from the overview export because there was no separate system PNG in the original Stitch output.
- The raw export HTML is preserved in `stitch-export/` so future work can inspect the generated screen code instead of relying only on screenshots.

## Current Implementation Status

- the Android admin app is live and connected to the backend
- the current native implementation partially follows this package, but does not yet fully match the screenshots
- the next UI pass should continue translating this package into native Android components rather than reverting to generic Material/dashboard patterns
