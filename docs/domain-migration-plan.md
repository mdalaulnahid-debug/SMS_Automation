# Domain Migration Plan: `licbarishal.duckdns.org` → `opsbarishal.com`

**Status: TLS cutover complete, zero downtime.** Both domains are live
simultaneously as of 2026-06-23. Remaining steps: migrate each gateway
phone's Backend URL and the admin bookmark at your own pace, then optionally
drop the old domain later.

## What actually happened (2026-06-23)

1. DNS A record added at the registrar (Cloudflare DNS, proxy disabled —
   "DNS only" — so traffic goes directly to the VPS, not through Cloudflare's
   edge). Verified via three independent public resolvers within minutes.
2. Found the live nginx config had drifted from the repo's template — it had
   **no IP restriction** (open to all IPs, key-only auth via `src/auth.js`),
   while the template restricted admin paths to one `ADMIN_IP`. Decision:
   keep it open — matches actual current behavior, avoids any lockout risk.
   `nginx/sms-backend.conf` and `scripts/setup-ssl.sh` updated to match.
3. **First approach (shared SAN cert via `certbot --expand`) failed
   reproducibly** with a 405 from Let's Encrypt's `finalize` API step,
   specific to expanding the existing `licbarishal.duckdns.org` cert's domain
   list — confirmed not a DNS/Cloudflare/nginx issue (a fresh standalone cert
   for `opsbarishal.com` alone succeeded immediately). Root cause not fully
   diagnosed (likely stale order/account-key state tied to that cert
   lineage) — not worth chasing further once a working alternative existed.
4. **Redesigned to one independent certificate per domain**, each with its
   own nginx HTTPS server block selected by SNI. Simpler and more robust
   than a shared cert anyway — each domain renews independently, no special
   `--expand` edge cases. `scripts/setup-ssl.sh` now generates the nginx
   config directly (loops over however many domains you pass) instead of
   templating a single shared cert path.
5. Ran `bash setup-ssl.sh licbarishal.duckdns.org opsbarishal.com` — left the
   existing `licbarishal.duckdns.org` cert untouched, issued a fresh cert for
   `opsbarishal.com`, and switched nginx to serve both via separate server
   blocks. Verified both return `200 OK` over HTTPS with valid certs and
   correct security headers immediately after.

## Why this is low-risk

Nothing in the codebase hardcodes the duckdns domain:

- The Telegram bridge talks to `http://localhost:3000` directly (no domain
  involved at all — long-polling, not a webhook).
- The Android app has no hardcoded domain/IP; "Backend URL" is a per-device
  Settings field the operator types in. The only `45.77.240.195` reference in
  `android-gateway/` is placeholder *hint text* in `activity_settings.xml`,
  not a functional value.
- `scripts/setup-ssl.sh` accepts any number of domains; each gets its own
  independent cert and nginx server block.

Only two things actually depend on the current domain string:
1. Each gateway phone's stored **Backend URL** setting (Settings screen).
2. Your own bookmark for the admin console.

## Remaining steps

1. **Update every gateway phone's Backend URL** to `https://opsbarishal.com`
   and tap "Test Connection" on each, at your own pace — the old domain
   keeps working throughout, so there's no urgency/race.
2. **Update the admin bookmark** to `https://opsbarishal.com/admin`.
3. **Once every phone and bookmark is confirmed migrated, drop the old
   domain** (optional cleanup, not required):
   ```
   ssh root@45.77.240.195 "bash /opt/sms-backend/scripts/setup-ssl.sh opsbarishal.com"
   ```
   Re-running with only the new domain rewrites nginx to serve only it
   (the `licbarishal.duckdns.org` cert and DNS record are left alone —
   delete those separately, deliberately, if you ever want to). There's no
   harm in leaving both active indefinitely instead.
4. **Update docs** once confirmed working: `progress_tracker.md`'s
   Environment table, and the historical domain references in
   `docs/CHANGELOG-2026-06-18.md` can stay as-is (dated history) but should
   get a note pointing at this migration.

## Rollback

Both certs/domains are independent and both still live — nothing to roll
back. If a future re-run of `setup-ssl.sh` ever breaks nginx, the previous
config isn't auto-backed-up; re-run with the exact same domain list to
regenerate it identically, or restore from `data/automation.db.bak`-style
backups if `/etc/nginx/sites-available/sms-backend` itself needs recovery.

## Open question — still unresolved

Confirm via `adb shell` or each phone's own Settings screen which Backend URL
the three gateway phones (`GP_PHONE_01`, `ROBI_PHONE_01`,
`BANGLALINK_PHONE_01`) are actually using today — never verified, only
assumed from setup docs. Doesn't block anything (both domains work), but
needed before step 1 above can be marked complete for each phone.
