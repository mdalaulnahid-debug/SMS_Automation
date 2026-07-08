# Personnel Registry source

This folder holds the source spreadsheet for the Personnel Registry
(security-hardening V1 — see `docs/security-hardening-v1-design.md` §6).

**The `.xlsx` file itself is gitignored** — it contains real officer names,
official phone numbers, and official emails, which must never be committed
to git.

## To update the roster

1. Edit `Address Book.xlsx` in this folder (add/remove/correct rows —
   columns: Designation, Name, Unit, Mobile Number(official), Mail(official)).
2. Re-import it. **There is no admin-console UI for this yet** — only the
   backend endpoint exists (`POST /api/admin/personnel-registry/import`,
   admin-auth-gated, raw `.xlsx` bytes as the POST body). Until a console
   button is built, re-run the same import used to load this roster the
   first time (a small local Node script calling `UserAuthStore.replaceRegistry()`
   directly, or an authenticated `curl --data-binary`).
3. Importing **wholesale-replaces** the roster — it doesn't merge, so the
   file/upload should always contain the full current roster, not just the
   changed rows.

Local dev's `data/auth.db` already has the current version imported
(22 records, as of 2026-07-08).
