# Domain Migration Plan: `licbarishal.duckdns.org` → `opsbarishal.com`

**Status: in progress.** Domain purchased 2026-06-23. Zero-downtime cutover
chosen (serve both domains on one cert during the transition). Admin console
access stays open (key-only auth, no IP restriction) — confirmed this matches
the live VPS's actual current config, which had drifted from an older,
IP-restricted version of the nginx template. The template
(`nginx/sms-backend.conf`) and `scripts/setup-ssl.sh` were updated to match
this reality and to support multiple domains on one certificate.

## Why this is low-risk

Nothing in the codebase hardcodes the duckdns domain:

- The Telegram bridge talks to `http://localhost:3000` directly (no domain
  involved at all — long-polling, not a webhook).
- The Android app has no hardcoded domain/IP; "Backend URL" is a per-device
  Settings field the operator types in. The only `45.77.240.195` reference in
  `android-gateway/` is placeholder *hint text* in `activity_settings.xml`,
  not a functional value.
- The VPS's TLS setup is parameterized: `scripts/setup-ssl.sh` +
  `nginx/sms-backend.conf` accept any number of domains and request one
  Let's Encrypt SAN certificate covering all of them.

Only two things actually depend on the current domain string:
1. Each gateway phone's stored **Backend URL** setting (Settings screen).
2. Your own bookmark for the admin console.

## Procedure

1. **DNS first.** At the registrar, add an A record: `opsbarishal.com` →
   `45.77.240.195`. Confirm propagation with `nslookup opsbarishal.com`
   before touching the server — checked 2026-06-23, **not yet propagated**.

2. **Check current phone config.** On each gateway phone: Settings → Gateway
   & Connection → note the current "Backend URL" (bare IP `http://45.77.240.195:3000`
   or `https://licbarishal.duckdns.org`). Still unverified — see open
   question below.

3. **Expand the existing cert to cover both domains (zero-downtime):**
   ```
   ssh root@45.77.240.195 "bash /opt/sms-backend/scripts/setup-ssl.sh licbarishal.duckdns.org opsbarishal.com"
   ```
   The first domain (`licbarishal.duckdns.org`) must be listed first — it's
   the existing certbot lineage name, and `--expand` adds `opsbarishal.com`
   to that same certificate rather than replacing it. nginx's `server_name`
   then lists both, so **both domains keep working simultaneously** — no gap.

4. **Update every gateway phone's Backend URL** to `https://opsbarishal.com`
   and tap "Test Connection" on each, at your own pace — the old domain
   keeps working throughout, so there's no urgency/race here unlike the
   original single-domain plan.

5. **Update the admin bookmark** to `https://opsbarishal.com/admin`.

6. **Once every phone and bookmark is confirmed migrated, drop the old
   domain** (optional cleanup, not required):
   ```
   ssh root@45.77.240.195 "bash /opt/sms-backend/scripts/setup-ssl.sh opsbarishal.com"
   ```
   Re-running with only the new domain re-expands/recreates the cert lineage
   under `opsbarishal.com` and removes `licbarishal.duckdns.org` from
   `server_name`. Do this deliberately, not by default — there's no harm in
   leaving both active indefinitely.

7. **Update docs** once confirmed working: `progress_tracker.md`'s
   Environment table, and the historical domain references in
   `docs/CHANGELOG-2026-06-18.md` can stay as-is (dated history) but should
   get a note pointing at this migration.

## Rollback

Both certs/domains stay live throughout steps 3–5, so there's nothing to roll
back during the migration itself. If step 6 (dropping the old domain) causes
a problem, re-run step 3's command to restore both domains on the cert again.

## Open question — still unresolved

Confirm via `adb shell` or each phone's own Settings screen which Backend URL
the three gateway phones (`GP_PHONE_01`, `ROBI_PHONE_01`,
`BANGLALINK_PHONE_01`) are actually using today — never verified, only
assumed from setup docs. Doesn't block the migration (zero-downtime either
way), but needed before step 4 can be marked complete for each phone.
