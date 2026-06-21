# Domain Migration Plan: `licbarishal.duckdns.org` → `opsbarishal.com`

**Status: planned, not started.** Nothing below has been executed yet — this
is the agreed procedure for when the `opsbarishal.com` domain is purchased.

## Why this is low-risk

Nothing in the codebase hardcodes the duckdns domain:

- The Telegram bridge talks to `http://localhost:3000` directly (no domain
  involved at all — long-polling, not a webhook).
- The Android app has no hardcoded domain/IP; "Backend URL" is a per-device
  Settings field the operator types in. The only `45.77.240.195` reference in
  `android-gateway/` is placeholder *hint text* in `activity_settings.xml`,
  not a functional value.
- The VPS's TLS setup is already parameterized: `scripts/setup-ssl.sh` +
  `nginx/sms-backend.conf` (with `YOUR_DOMAIN`/`ADMIN_IP` placeholders) were
  built to be re-run for any domain.

Only two things actually depend on the current domain string:
1. Each gateway phone's stored **Backend URL** setting (Settings screen).
2. Your own bookmark for the admin console.

## Procedure

1. **DNS first.** At the registrar, add an A record: `opsbarishal.com` (or a
   subdomain) → `45.77.240.195`. Confirm propagation with
   `nslookup opsbarishal.com` before touching the server.

2. **Check current phone config.** On each gateway phone: Settings → Gateway
   & Connection → note the current "Backend URL" (bare IP `http://45.77.240.195:3000`
   or the existing `https://licbarishal.duckdns.org`).

3. **Issue the new cert / repoint nginx:**
   ```
   ssh root@45.77.240.195 "bash /opt/sms-backend/scripts/setup-ssl.sh opsbarishal.com <admin-wifi-ip>"
   ```
   Obtains a fresh Let's Encrypt cert and rewrites nginx's `server_name` to
   the new domain.

   **Known limitation (not yet fixed):** `setup-ssl.sh` replaces the nginx
   config wholesale rather than serving both domains at once — the moment
   this completes, `https://licbarishal.duckdns.org` stops resolving through
   nginx (the old cert stays on disk, but nginx no longer listens for that
   `server_name`). This is the one non-zero-downtime step. If a no-gap cutover
   matters, extend `nginx/sms-backend.conf` to accept a second `server_name`
   line (old + new domain) before running this step, then drop the old one
   in a follow-up pass once every phone is confirmed migrated.

4. **Update every gateway phone's Backend URL** to `https://opsbarishal.com`
   and tap "Test Connection" on each. **This is the step most likely to break
   the live workflow if skipped or delayed** — phones poll the backend every
   ~3s, so any phone still pointed at the old domain after step 3 will start
   failing heartbeats/job polls until updated.

5. **Update the admin bookmark** to `https://opsbarishal.com/admin`.

6. **Update docs** once confirmed working: `progress_tracker.md`'s
   Environment table, and the historical domain references in
   `docs/CHANGELOG-2026-06-18.md` can stay as-is (they're dated history, not
   active config) but should get a note pointing at this migration.

## Rollback

If something goes wrong after step 3, the old duckdns A record and Let's
Encrypt cert are untouched — re-running
`bash /opt/sms-backend/scripts/setup-ssl.sh licbarishal.duckdns.org <admin-wifi-ip>`
restores the previous nginx config immediately (cert is still valid, no new
ACME challenge needed unless it expired).

## Open question to resolve before executing

Confirm via `adb shell` or the phones' own Settings screen which Backend URL
each of the three gateway phones (`GP_PHONE_01`, `ROBI_PHONE_01`,
`BANGLALINK_PHONE_01`) is actually using today — this wasn't verified in the
session this plan was written in, only assumed from setup docs.
