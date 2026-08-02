# Personnel Registry source

This folder holds the source spreadsheet for the Personnel Registry
(security-hardening V1 — see `docs/security-hardening-v1-design.md` §6).

**The `.xlsx` file itself is gitignored** — it contains real officer names,
official phone numbers, and official emails, which must never be committed
to git.

## To update the roster

**Two ways, both in the admin console → Tools → Personnel Registry:**

1. **Bulk re-import (admin or super-admin).** Edit `Address Book.xlsx` in
   this folder (columns: Designation, Name, Unit, Mobile Number(official),
   Mail(official)), then use the file picker + **Import spreadsheet**
   button. This **wholesale-replaces** the roster — the file should always
   contain the full current roster, not just the changed rows.
2. **Add one officer (super-admin only).** The "Add to registry" form adds
   a single record without touching the rest of the roster — for one new
   hire between full re-imports.

Local dev's `data/auth.db` already has the current version imported
(22 records, as of 2026-07-08).
