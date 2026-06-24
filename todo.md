# Todo

Start with `progress_tracker.md` for the latest session handoff, test results, and environment details.

---

## Todo — 2026-06-24: Enhanced Security & Admin Controls (IP/Device Tracking + Admin Messages)

**Scope:** Prevent unauthorized access via shared credentials / Telegram Web hijacking + allow admins to post non-command messages (alerts, notices, rules) in the group.

### Phase 1: IP & Device Identity Tracking (foundation)
- [ ] Add IP address capture to every request (extract from Telegram message metadata or X-Forwarded-For header)
- [ ] Add device fingerprinting (hash of user_agent + screen resolution + browser + timezone)
- [ ] Store both in request record: `{ sourceIp, deviceId, deviceInfo: { userAgent, screenResolution, platform, timezone } }`
- [ ] Persist to database (currently requests are in-memory)
- [ ] Display in admin dashboard: show request detail view with IP + device + geolocation

### Phase 2: Admin Message Bypass (group hygiene)
- [ ] Add `isAdmin` boolean field to `authorizedUsers` in `config/telegram.json`
- [ ] Modify `telegram-bridge/bridge.js` `planIntake()` to recognize `[ADMIN]` prefixed messages from admins
- [ ] Admin messages bypass command validation (allow alerts, notices, rules in group without rejection)
- [ ] Non-admin messages still enforced as command-only (current behavior)
- [ ] Test: admins can post `[ADMIN] ⚠️ Maintenance 2-3 AM tomorrow` without it being flagged as unsupported command
- [ ] Persist admin messages to database (audit trail)

### Phase 3: Anomaly Detection & Alerting
- [ ] Flag if same officer submits from 3+ different IPs within 1 hour (possible hijack or travel)
- [ ] Flag if new IP seen for officer (first time from that country/ISP)
- [ ] Flag if new device seen for officer (new fingerprint)
- [ ] Display alerts in admin dashboard with recommendation to investigate
- [ ] Optionally: auto-email admin when anomaly triggered

### Phase 4: Geolocation & Device Reputation (high-security)
- [ ] Integrate IP geolocation lookup (MaxMind GeoIP2 or similar) → country, city, ISP
- [ ] Assign device reputation score: 0 (new/unknown) → 100 (trusted, long history)
- [ ] New device (score 0) → auto-require manual supervisor approval before request is processed
- [ ] Auto-disable officer account if 5+ requests from different IPs in <1 hour (brute-force hijack pattern)
- [ ] Admin can manually override device score (mark device as trusted)

### Phase 5: Admin Audit Log (compliance)
- [ ] Log who posted what admin message (timestamp, message content, sender)
- [ ] Log who approved/rejected requests and from which device/IP
- [ ] Downloadable audit report: "All requests from IP 192.168.x.x in date range Y-Z"
- [ ] Log all admin overrides (marking device as trusted, disabling account, etc.)

**Why Option C:** Small but high-stakes system (police). Credential sharing is the biggest risk. IP/device tracking + anomaly alerting catches 80% of hijacking attempts. Admin messages reduce friction (no more "use email for alerts" workaround). Geolocation + device reputation adds friction but blocks automated attacks.

**Risk if delayed:** Officers sharing credentials with colleagues (or colleagues borrowing devices) is likely *already happening*. Without auditing, you won't know. Auditing doesn't prevent it, but makes it detectable and reversible.

---

## Todo — 2026-06-24: Data Encryption at Rest (Optional, Recommended)

**Problem:** If VPS is breached/hacked, attacker can read plaintext database, SMS replies, officer requests from disk. Encryption at rest stops this.

**Current Status:** No encryption on Vultr VPS (checked 2026-06-24; LUKS not detected).

### Phase 1: Add Encrypted Block Storage (Vultr) — RECOMMENDED
- [ ] Create 50GB encrypted block storage in Vultr control panel (Singapore region)
  - Cost: ~$5-10/month
  - Encryption: AES-256, provider-managed
- [ ] SSH into VPS and mount at `/var/lib/sms-data`
- [ ] Migrate `/opt/sms-backend/data/` (database) to encrypted volume
- [ ] Add persistent mount in `/etc/fstab`
- [ ] Verify: `lsblk` shows encrypted volume; database still accessible
- [ ] Backup current database before migration
- [ ] Effort: ~1 hour; Risk: low (with backup)

**Why:** Protects against disk theft, provider snooping, accidental data exposure. Single point of risk: Vultr retains master key (but they have no incentive to snoop).

### Phase 2: Application-Level Encryption (Optional, High Security)
- [ ] Add encryption functions to `src/database.js` (AES-256-GCM)
- [ ] Identify sensitive fields to encrypt:
  - `sms_reply_text` (operator responses with NID/MSISDN/location)
  - `request_payload` (officer's original request)
  - Do NOT encrypt: `requestId`, `timestamp`, `requesterName`, `requestType` (needed for indexing/filtering)
- [ ] Generate encryption key (one-time, 64-char hex) via `openssl rand -hex 32`
- [ ] Store key in `/opt/sms-backend/encryption.key` (chmod 600, not in git)
- [ ] Load key at app startup from environment or file
- [ ] Add `encrypt()` / `decrypt()` wrapper functions
- [ ] Encrypt on INSERT, decrypt on SELECT
- [ ] Test: verify data in SQLite is gibberish; app still reads correctly
- [ ] Effort: 2-3 days; Risk: medium (key management complexity)

**Why:** Protects against root-level attacker on VPS. Even if someone gets root access, they can't read encrypted SMS without the key. Two-layer defense: Vultr's disk encryption + app encryption.

### Phase 3: Key Rotation & Backup (If Implementing Phase 2)
- [ ] Design key rotation: keep old key for reading, new key for writing
- [ ] Document backup procedure: encryption key stored encrypted offline (1Password, USB, etc.)
- [ ] Document restore procedure: if VPS lost, restore with backup key
- [ ] Quarterly: rotate key, re-encrypt historical data

**Recommendation:** Start with Phase 1 (Vultr encrypted block storage) immediately — low effort, high impact. Phase 2 only if you handle very sensitive data and want maximum protection.

---

## Todo — 2026-06-24: Add Login & Access Control (Public Ops Page + Admin Console)

**Current problem:** Public ops page (`/`) is open to anyone — no authentication. Anyone with the URL can view system status, dashboard, etc. Admin console (`/admin`) has API key auth (password in localStorage) but no login page UI.

**Scope:** Add proper login gates for both public ops page and admin console.

### Public Ops Page Login (`/`)
- [ ] Create `/login` page (before the current public ops dashboard)
- [ ] Login methods (operator ID or username)
  - Option A: Telegram ID (e.g., `8914564310`) — requires officers already have Telegram
  - Option B: Username/email + password (new account system)
  - Option C: Both (Telegram or username+password)
- [ ] Validate against `authorizedUsers` list in `config/telegram.json`
- [ ] Redirect unauthenticated users to `/login` (currently they land on `/`)
- [ ] Store session in browser (JWT token or encrypted localStorage)
- [ ] Add logout button in header
- [ ] Display "Logged in as: [Officer Name]" in top-right
- [ ] Session timeout after 8 hours of inactivity (auto-logout)

### Admin Console Login (`/admin`)
- [ ] Create dedicated `/admin/login` page (instead of inline API key input)
- [ ] Admin enters API key or username/password
- [ ] Validate against `adminApiKey` and new `adminUsers` list
- [ ] Same session/token system as public login
- [ ] Require admin approval workflow (optional but recommended):
  - First-time admin login → email/SMS notification to super-admin
  - Super-admin approves/denies in dashboard
  - Only then can new admin access the console
- [ ] Add audit log: "Admin [Name] logged in from [IP]" (use from Phase 1 IP tracking)

### Optional Enhancements
- [ ] MFA (multi-factor auth) for admin logins
  - Admin enters password + 6-digit SMS code sent to registered phone
  - Dramatically reduces risk of credential sharing
- [ ] Login attempts logging:
  - Log failed login attempts (brute-force detection)
  - Auto-lock account after 5 failed attempts (unlock via admin or after 30 min)
- [ ] Session device binding:
  - Can't use same session from different device/IP (prevents token hijacking)

### Files to Create/Modify
- **New:** `public/login.html` — public ops login page
- **New:** `public/admin-login.html` — admin login page
- **Modify:** `public/index.html` — add session check + redirect to login if not authenticated
- **Modify:** `public/admin.html` — add session check + redirect to admin-login if not authenticated
- **Modify:** `public/app.js` — add login/logout handlers, session validation
- **Modify:** `public/admin.js` — same
- **New:** `src/auth-session.js` — centralized session management (create JWT, validate, expire)
- **Modify:** `src/routes.js` or wherever auth endpoints live — add `/api/login`, `/api/logout`, `/api/validate-session`
- **Modify:** `config/telegram.json` — add `adminUsers` list with admin approval status

### Deployment Considerations
- Update `progress_tracker.md` docs with new login URLs and default admin account setup
- Add migration guide: existing officers need to "sign up" or get enrolled by admin
- Default admin account (first super-admin to log in) — needs careful setup to avoid lockout

**Why:** Currently anyone with the URL is in. Login gate + approval workflow ensures only authorized officers access the system. Admin approval on first login adds an extra gate against credential sharing or unauthorized access.

---

## Todo — 2026-06-24: Prevent Insider Threats & Unauthorized Access Delegation

**Problem:** Authorized officers (seniors) may:
- Share credentials with juniors out of laziness ("just use my login")
- Give juniors access without admin approval (bypass authorization)
- Not understand security implications (lack technical knowledge)
- Use one shared account for a whole team (audit trail is useless)

**Goal:** Make unauthorized access **difficult** (not impossible, but flagged + auditable).

### Layer 1: Technical Barriers

#### 1a. Per-Officer Session Binding (Medium Difficulty)
- [ ] Each login creates a session with device fingerprint
- [ ] Session only works from same device/IP/browser (original session binding)
- [ ] If someone tries to use the same token from a different phone/laptop/IP → **new login required**
- [ ] Prevents: casual credential sharing ("use my Telegram ID from your phone")
- [ ] Doesn't prevent: determined sharing (attacker logs in fresh from new device)
- [ ] Effort: 1-2 days
- [ ] False positives: officer moves between office/home/field → new login each time (friction)

**Code sketch:**
```javascript
// Session includes device fingerprint
const sessionToken = {
  userId: '8914564310',
  deviceId: hash(userAgent + screenRes + timezone),
  issuedAt: Date.now(),
  expiresAt: Date.now() + 8*60*60*1000
};

// On next request, verify:
if (currentDeviceId !== sessionToken.deviceId) {
  // Device changed → require fresh login
  redirectToLogin();
}
```

#### 1b. Request Signature (High Security, Friction)
- [ ] Each request requires a fresh confirmation step
- [ ] Officer taps "Approve" button in app with fingerprint/PIN before submit
- [ ] Prevents: automated misuse (attacker can't script bulk requests)
- [ ] Doesn't prevent: determined attacker who physically has the phone
- [ ] Effort: 1 day (if using fingerprint auth)
- [ ] Friction: HIGH (every request needs approval)

#### 1c. Rate Limiting by Officer (Medium Difficulty)
- [ ] Each officer has a daily quota (e.g., 50 requests/day, 10 requests/hour)
- [ ] Quota resets daily (prevents bulk abuse)
- [ ] Admin can adjust per officer (field officers get higher quota)
- [ ] Effort: 2-3 hours
- [ ] Friction: LOW if quotas are generous

**Example:**
```
SI Nazmul (field) → 100 requests/day, 15/hour
Junior Officer (desk) → 20 requests/day, 5/hour
Admin → unlimited
```

---

### Layer 2: Detection & Alerting (Catches Misuse)

#### 2a. Anomaly Detection Dashboard
- [ ] Supervisor dashboard: see all requests in real-time
  - Who submitted it
  - From which IP/device (use Phase 1 IP tracking)
  - What they requested
  - When
- [ ] Flag suspicious patterns:
  - **Bulk requests**: same officer, 20 requests in 5 minutes → alert
  - **New device**: officer never seen from this IP/device before → alert
  - **Off-hours**: request at 3 AM when officer normally sleeps → alert
  - **Rapid location change**: request from India, then Bangladesh 5 min later → alert
  - **Quota exceeded**: officer hit their daily limit → auto-block + alert
- [ ] Supervisor action: **immediately revoke access** for suspicious officer
- [ ] Effort: 2-3 days (requires dashboard UI + alert logic)
- [ ] Impact: HIGH (detects most lazy access sharing)

**Alert triggers:**
```javascript
const suspiciousPatterns = [
  { pattern: 'bulk_requests', threshold: '>10 requests in 5 min' },
  { pattern: 'new_device', threshold: 'device not seen before' },
  { pattern: 'off_hours', threshold: 'request outside 6 AM - 10 PM' },
  { pattern: 'location_jump', threshold: 'different country in <10 min' },
  { pattern: 'quota_exceeded', threshold: 'officer daily limit hit' }
];
```

#### 2b. Audit Log for Supervisors
- [ ] Every request logged with full metadata:
  - Officer name + ID
  - Timestamp, IP, device, location
  - Request type + payload
  - Approval status (approved/rejected/pending)
  - Who approved it (supervisor name)
- [ ] Downloadable report: "All requests by SI Nazmul in June"
- [ ] Downloadable report: "All requests from IP 203.195.x.x"
- [ ] Historical view: supervisor can see patterns over weeks/months
- [ ] Effort: 1-2 days (if database already stores this)
- [ ] Impact: HIGH (makes misuse traceable; deters lazy sharing)

---

### Layer 3: Operational / Policy (Human Controls)

#### 3a. No Shared Accounts
- [ ] **Policy:** One officer = one account. No "team login."
- [ ] **Enforcement:** Each junior must request their own access through admin
- [ ] **Approval:** Supervisor approves juniors in writing (email + admin dashboard)
- [ ] **Audit:** Admin logs who approved each junior
- [ ] Effort: 0 (policy only)
- [ ] Impact: HIGH (makes unauthorized access traceable to specific person)

#### 3b. Quarterly Access Review
- [ ] Every 3 months, supervisor reviews who has access
- [ ] Check: Are all these people still assigned to this role?
- [ ] Action: Disable inactive officers; approve new joiners
- [ ] Effort: 1 hour per supervisor per quarter
- [ ] Impact: MEDIUM (catches stale accounts)

#### 3c. Access Termination on Transfer
- [ ] When officer transfers to different unit, **immediately disable access**
- [ ] Admin sends approval email to supervisor (confirm termination)
- [ ] Officer logs out; can't access dashboard anymore
- [ ] Effort: 5 min per termination (admin clicks "Disable")
- [ ] Impact: HIGH (prevents former officers from misusing access)

#### 3d. Officer Training (Awareness)
- [ ] Email + poster: "Do not share your credentials with juniors. Each person must request their own access."
- [ ] Explain: Unauthorized access is traceable; misuse penalties apply
- [ ] Effort: 1 hour (write email + print poster)
- [ ] Impact: MEDIUM (awareness alone doesn't stop determined sharing, but helps)

---

### Layer 4: Enforcement & Consequences

#### 4a. Catch & Revoke
- [ ] Supervisor spots suspicious pattern (bulk requests from new device)
- [ ] Immediately revokes officer's access
- [ ] Officer locked out; can't submit requests
- [ ] Supervisor notifies officer: "Your access was disabled due to suspicious activity on 2026-06-24. Contact your commanding officer."
- [ ] Effort: 5 min per incident
- [ ] Impact: HIGH (immediate consequence for misuse)

#### 4b. Incident Report
- [ ] When access is revoked for misuse, admin generates incident report:
  - Date / time
  - Officer name
  - Suspicious pattern detected
  - Action taken (access revoked)
- [ ] Report sent to commanding officer
- [ ] Creates paper trail (compliance + deterrent)
- [ ] Effort: 2-3 hours to build reporting feature
- [ ] Impact: HIGH (formal consequences; deters future misuse)

---

## Recommended Rollout (Insider Threat Prevention)

### Week 1: Detection
- [ ] Add IP/device logging (Phase 1 from security roadmap)
- [ ] Build anomaly detection (bulk requests, new device, off-hours)
- [ ] Supervisor dashboard showing alerts
- [ ] **Goal:** See where misuse is happening

### Week 2: Policy
- [ ] Announce: "No shared accounts. Each person requests their own access."
- [ ] Quarterly access review (supervisor checklist)
- [ ] Access termination process (disable on transfer)
- [ ] **Goal:** Make unauthorized access harder

### Week 3: Enforcement
- [ ] Revoke access for suspicious officers
- [ ] Generate incident reports
- [ ] Notify commanding officers
- [ ] **Goal:** Consequences for misuse

### Week 4: Hardening (Optional)
- [ ] Session device binding (if anomalies continue)
- [ ] Rate limiting by officer (if bulk requests detected)
- [ ] Request signature (fingerprint approval) if very high-security needs

---

## Summary: Layered Defense Against Insider Threats

| Layer | What It Does | Cost | Effort | Impact |
|-------|--------------|------|--------|--------|
| **Technical Barriers** | Makes unauthorized access harder (session binding, rate limits) | Low | Medium | MEDIUM |
| **Detection & Alerting** | Flags suspicious patterns in real-time | Low | Medium | HIGH |
| **Audit Trail** | Makes misuse traceable to specific person | Free | Low | HIGH |
| **Policy & Training** | Sets expectations; deters lazy sharing | Free | Low | MEDIUM |
| **Enforcement** | Immediate consequences (revoke access) | Free | Low | HIGH |

**The key insight:** You can't prevent someone determined to share credentials. But you *can* make it:
1. **Detectable** (audit trail, anomaly alerts)
2. **Traceable** (who did what, when, from where)
3. **Consequential** (immediate access revocation)

This deters 90% of casual misuse (lazy seniors sharing with juniors). The remaining 10% (determined attackers) requires additional hardening.

---

## Done — 2026-06-23: Branding, desktop redesign, and light-mode fix

Five-commit pass on the public web surfaces, all deployed and verified live:

1. **Bangladesh Police insignia branding** (`2f1a0c5`) — navy (`#04014B`) /
   silver (`#C7CBD4`) palette from the official insignia, applied to
   `theme.css`, both Android apps' `colors.xml` (Gateway app converted from
   light teal to dark navy to match), header logos + favicon on both web
   pages, denser list/row styling inspired by a Netmonitor-style reference
   app. Both Android modules build clean; installed and visually confirmed
   on the physical A55 admin phone.
2. **`deploy.sh` fix** (`df996d1`) — `scp public/*` doesn't recurse into
   directories and broke once `public/assets/` (the insignia) existed;
   switched to `find -maxdepth 1 -type f`.
3. **Desktop redesign of the public ops page** (`8a5278d`) — `index.html`
   was a phone-app shell (`max-width: 480px`) with huge empty margins on a
   real monitor. Added a ≥900px breakpoint that switches to a full-width
   sidebar dashboard (reusing `admin.html`'s proven `.admin-shell` pattern),
   with new Home/Activity/About/Contact/Help/Access tabs. Mobile (<900px)
   is pixel-identical to before. About/Help have real content (system
   description, actual bot command syntax); Contact was a placeholder.
4. **Real contact details** (`cee612f`) — LIC Barishal phone, email
   (`support@opsbarishal.com` — **not a live mailbox yet**, create before
   officers try to use it), Telegram, WhatsApp added to the Contact tab.
5. **Light-mode contrast fix** (`edfcd59`) — `.kpi-tile` and both pages'
   headers/sidebars/bottom-nav had hardcoded dark-navy backgrounds totally
   independent of the light/dark toggle. In light mode this produced dark
   text directly on near-black blocks — unreadable. Added theme-aware
   variables (`--kpi-tile-bg`, `--bg-chrome-header`, `--bg-chrome-nav`,
   `--bg-chrome-sidebar`) with real light-mode values; dark mode unchanged.

Verified throughout: 142 tests pass after every step (all pure front-end/
asset changes, no backend touched), browser-preview screenshots at 1280px
and 375px in both themes, VPS file hashes confirmed byte-identical to git
HEAD (`edfcd59`) after the final deploy.

## Done — 2026-06-23: `www.opsbarishal.com` added — all three domains live

CNAME added in Cloudflare (`www` → `opsbarishal.com`, DNS-only). Ran
`bash /opt/sms-backend/scripts/setup-ssl.sh licbarishal.duckdns.org opsbarishal.com www.opsbarishal.com`
— `www.opsbarishal.com` got its own independent cert, the other two domains'
certs were left untouched. All three confirmed `200 OK` on `/api/health`,
and the login lockdown (see entry below) holds consistently across all of
them since it's enforced server-side, not per-domain.

## Done — 2026-06-23: Locked down the entire public ops surface behind login

Follow-up to the data-exposure fix above. Asked directly "can everybody
visit opsbarishal.com?" — answer was yes (intentional, no IP restriction),
but the follow-up decision was to require login for the *whole* surface,
not just sanitize the public status page.

- `src/app.js`: `/api/ops/overview`, `/api/ops/activity`, `/api/ops/gateways`
  now require the admin key (`requireAdmin`), same as every other admin
  endpoint — no longer "public, but sanitized."
- `public/index.html` + `app.js`: replaced the old dismissible "unlock extra
  widgets" overlay with a true blocking gate mirroring `admin.html`'s pattern
  — the entire app (`#opsApp`) stays hidden until a key is entered AND
  verified against the backend (previously it just trusted whatever was
  typed). A 401 mid-session re-hides the app rather than leaving stale data
  rendered underneath the gate.
- Updated the earlier sanitization test (`test/security.test.js`) — it had
  asserted unauthenticated access returns 200 (correct at the time); now
  asserts 401, and still checks sanitization holds for the authenticated
  case as defense in depth.
- Verified end to end against both the local dev server and production:
  server returns 401 with no key / 200 with the right key; client shows
  nothing but the gate with no key, an error on a wrong key, full dashboard
  only after a verified key. 142 tests pass.

## Done — 2026-06-23 (CRITICAL): Fixed unauthenticated data exposure on the public ops feed

While confirming what `opsbarishal.com` exposes to anonymous visitors (asked
directly: "can everybody visit it?"), found that `/api/ops/activity` and
`/api/ops/overview` — the public landing page's data source, **no admin auth
by design** — were leaking real investigation data to anyone, no login
required. Confirmed live in production before fixing: a real MSISDN, IMEI,
IMSI, and physical address from an active request were visible to any
visitor. This almost certainly existed on `licbarishal.duckdns.org` too —
the domain move didn't cause it, just made it more likely someone would
notice/visit the cleaner-looking domain.

- **Root cause**: `buildActivityFeed()`'s `summary`/`meta` fields carry raw
  SMS content for the admin-authenticated audit view, and that was flowing
  straight through to the public endpoint unfiltered.
- **First pass only covered 4 "obviously risky" event types** and missed a
  second leak: `UNAUTHORIZED_SMS_SEND`'s audit row stores the recipient
  phone number in the `requestId` slot (`src/app.js`'s `/api/gateway/watchdog`
  handler), which then surfaced as a plain `'audit'`-type event's summary —
  a field that looked generic enough to seem safe.
- **Fixed properly**: stripped `summary`/`meta` *unconditionally* for every
  event type on the public feed, rather than continuing to enumerate which
  types/actions happen to carry sensitive payloads.
- Verified against production: 0 of 40 public activity events now carry
  `summary` or `meta`; admin-authenticated endpoints unaffected.
- New regression test in `test/security.test.js` seeds real-shaped sensitive
  content (MSISDN, IMEI, IMSI, address, watchdog-reported number) and
  asserts none of it reaches the unauthenticated endpoint, while confirming
  the admin view still shows it.
- 142 tests pass (1 new). Deployed immediately given severity.

**Open question worth considering**: should `/api/ops/*` require admin auth
at all, rather than just sanitizing its content? It currently exists to
power a public-facing "is the system healthy" status page — if that's not
actually needed by anyone outside the team, gating it entirely would be
simpler and more defensive than maintaining a sanitizer. Not changed this
pass since the public status page may be intentional; flagging for a
decision.

## Done — 2026-06-23: Domain migration TLS cutover — opsbarishal.com live, zero downtime

`https://opsbarishal.com` is now live on the VPS alongside the existing
`https://licbarishal.duckdns.org` — both work simultaneously, full details
and remaining steps in `docs/domain-migration-plan.md`.

- First attempt used a shared SAN cert via `certbot --expand`, which failed
  reproducibly with a 405 at Let's Encrypt's finalize step (isolated to the
  expand-existing-cert path — a fresh standalone cert worked immediately).
  Redesigned `scripts/setup-ssl.sh` to give each domain its own independent
  certificate and nginx server block (SNI) — simpler, no shared-cert edge
  cases, each domain renews on its own.
- Also fixed a template/reality drift found along the way: the live nginx
  config had no IP restriction on the admin console (key-only auth), while
  the repo's `nginx/sms-backend.conf` template had an `ADMIN_IP` allowlist
  that was never actually applied. Removed it from the template to match
  reality, rather than letting the next `setup-ssl.sh` run silently
  introduce a new restriction.
- Verified both domains return `200 OK` over HTTPS with valid certs and
  correct security headers. 141 tests still pass (no app code touched, only
  `scripts/setup-ssl.sh` and `nginx/sms-backend.conf`).
- **Remaining**: migrate each gateway phone's Backend URL to
  `https://opsbarishal.com` (no urgency — old domain still works), update
  the admin bookmark, optionally drop the old domain later.

## Version History

| Version | Date | Tag | Description |
|---------|------|-----|-------------|
| **v3.0.0** | 2026-06-23 | `v3.0.0` | Stable checkpoint. Open group auth, forward-aware tagging, reply matching hardening, curated training workbooks, 141 tests passing. Restore: `git checkout v3.0.0` |

To revert the VPS to a tagged version:
```bash
git checkout v3.0.0
bash scripts/deploy.sh
```

---

## Done — 2026-06-23: Opened group auth for forwarded messages + forward-aware tagging

Two issues found and fixed, both related to officers forwarding requests from
colleagues into the Telegram group:

1. **Group auth was too restrictive.** The `authorizedUsers` whitelist in
   `config/telegram.json` gated both private DMs and group submissions. Adding
   the Addl SP's Telegram ID (needed for private-DM access on 2026-06-20) closed
   the group — every other officer's messages were silently rejected as
   "unauthorized group sender." VPS logs confirmed 5+ distinct officers blocked
   (Muladi Circle, OC Hijla, OC Babugong, Oc Gournadi, Bakerganj Circle).
   **Fixed:** `planIntake()` no longer checks `authorizedUsers` for group chat
   messages. Any group member can submit. Private DM gating unchanged.
2. **Forwarded message tagging.** `planIntake()` now detects `forward_from` /
   `forward_sender_name` and stores the original author as `forwardedFrom`
   metadata for audit. Replies always tag `message.from` (the group member who
   forwarded), never the original external author.
- Recovered 3 silently rejected requests by manual API resubmission
  (REQ-0285 IMEI-MS 4 IMEIs, REQ-0286 LCL, REQ-0287 LRL).
- 19 bridge tests pass (2 new for forwarded message tagging).

## Done — 2026-06-22: Fixed deploy.sh clobbering runtime Telegram config + bot scolding forwarded messages

Two real bugs reported by the user, both confirmed against live VPS logs/config
before fixing:

1. **`deploy.sh` was silently wiping `authorizedUsers` on every deploy.**
   It unconditionally `scp`'d the local `config/telegram.json` over the VPS's
   runtime copy. The authorized officer added via the admin console the night
   of 2026-06-20 only ever existed in the VPS's runtime file — the next
   `bash scripts/deploy.sh` run (same night, shipping the reply-matching fix)
   clobbered it back to `authorizedUsers: {}`, and the officer's private DMs
   were silently rejected from that point on (`intake: unauthorized private
   sender 8914564310` — confirmed in `pm2 logs sms-bridge`). Fixed: `deploy.sh`
   now only copies `config/telegram.json` if it doesn't already exist on the
   VPS (first-time bootstrap) — once present, it's runtime-owned by the admin
   console/app and never overwritten by a deploy. Re-added the wiped officer
   and synced the local file to match so this doesn't drift again.
2. **The bot was replying "Unsupported command" to its own forwarded/quoted
   output.** No code distinguished "someone forwarded the bot's previous
   answer back into the group" (common — sharing a result with another
   officer) from "someone typed a malformed command." Fixed: `planIntake()`
   recognizes fingerprints of our own output (`\nProcessed at:` from combined
   replies, the `✅ Request received` ack, the literal "Unsupported
   command..." text) and silently ignores them.
- Verified: 141 tests pass (3 new in `test/telegramBridge.test.js`), deployed,
  confirmed `config/telegram.json` survived the deploy this time, confirmed
  the bridge restarted with the officer's DM access restored.

## Done — 2026-06-22: Confirmed group is command-only by policy; added Rejected Messages visibility

Followed up on the "Unsupported command" investigation above. Pulled the exact
raw text of two real past rejections straight from the SQLite `audit_logs`
table (bridge logs at the time didn't capture it): a forwarded WhatsApp-style
chat log (`[21/06, 20:36] Si Morsed Hizla: IMEI-MS 864268073757900`, prefixed
per-line so the parser's first token was `[21/06,` not `IMEI-MS`) and a
Bengali Zoom-meeting announcement posted by "LIC Barisal."

- Initially shipped a fix (`looksLikeCommandAttempt()`) that suppressed the
  "Unsupported command" reply for messages that didn't look like a real
  command attempt. **Reverted per explicit instruction**: the group is
  command-only by policy — no other message should be tolerated there at all,
  so every non-command message should keep getting flagged, including
  forwarded logs and announcements. `telegram-bridge/bridge.js` is back to
  always replying to `UNSUPPORTED_COMMAND` (unless it's an authorization-style
  suppression, which is a separate, intentional policy).
- The real, valid complaint was **visibility**, not over-flagging: there was
  no way to see what a "wrong message" actually said without querying the
  SQLite `audit_logs` table by hand. `/api/admin/audit` only returns the most
  recent 250 audit rows total — with ~40+ `SMS_INBOUND`/`SMS_REPLY_UNMATCHED`
  rows per hour on a busy day, a `REQUEST_VALIDATION_FAILED` entry can scroll
  out of that window within an hour.
- Added `GET /api/admin/rejected-messages` (admin-gated) — reads the full
  in-memory audit log (not the 250-row slice), filters to
  `REQUEST_VALIDATION_FAILED` only, returns up to 200 with full untruncated
  `rawText`, requester, chat, and error code. New "Rejected Messages" tab in
  the web admin console (`public/admin.html`/`admin.js`) lists them with a
  detail pane showing the complete original text — no more digging through
  logs or the database to see what was actually rejected.
- Verified live in the browser preview: submitted the real forwarded-chat-log
  text against the local dev backend, confirmed it appears in the new panel
  with full multi-line text intact, confirmed detail pane renders correctly.
  141 tests still pass (no test changes needed for this pass — the revert
  brought `test/telegramBridge.test.js` back in line with the original
  strict-enforcement test, and the new endpoint is a straightforward audit
  filter with no new business logic to unit test beyond what's already
  covered).

## Planned — Domain migration: `licbarishal.duckdns.org` → `opsbarishal.com`

Not started yet — buying the domain first. Full step-by-step procedure,
rollback plan, and the one known non-zero-downtime gap are documented in
`docs/domain-migration-plan.md`. Short version: nothing in the codebase
hardcodes the duckdns domain (Telegram bridge uses localhost, Android app has
no hardcoded domain) — the only things that need updating are nginx's TLS
config on the VPS (`scripts/setup-ssl.sh`, already parameterized) and each
gateway phone's Backend URL setting.

## Done — 2026-06-20 (night): Fixed reply-type misclassification + added correction tooling

Real incident: a requester's `LRL 01718589986` private-DM request got the wrong
answer delivered — an unrelated GP reply ("Sorry No records found for IMEI:
353917104327090 [GP]") was auto-matched onto it, and the real LRL reply (which
arrived two minutes later with full location data) found nothing left to
attach to and was silently dropped.

- **Root cause**: `src/replyAnalyzer.js`'s IMEI/NID strong-type regexes were
  line-anchored (`(?:^|\n)\s*imei[:\s]`), so GP's "no records found" template
  (keyword mid-sentence) never registered as IMEI-typed. The reply scored
  type-neutral, and the single-pending-request fallback in
  `findActiveRequestForGateway` — payload-blind by design — accepted it since
  it was the only open request on that gateway at the time.
- **Fix**: added unanchored fallback patterns for IMEI/NID "no records found"
  replies, so `replyTypeScore` now correctly rejects a same-gateway reply whose
  type doesn't match the request, even with only one candidate pending.
- **New correction tooling** (for cases like this where a wrong match already
  finalized): `service.rankReplyCandidates(inboxId)` ranks every plausible
  request — including already-`COMPLETED` ones — using the exact same scoring
  as live auto-matching; `service.correctMatch(inboxId, requestId)` re-attaches
  the orphaned reply, detaches the wrongly-matched one, and posts a new
  `⚠️ Correction —` reply instead of silently rewriting history. New endpoints:
  `GET /api/admin/unmatched/:id/candidates`, `POST /api/admin/correct-match`.
  The web admin console's unmatched-SMS panel now shows ranked candidates with
  scores instead of a flat unranked list.
- **Recovered tonight's actual stuck request** (`REQ-20260620-0118-D5UQ`) live
  via the new endpoint — the correct LRL answer was posted to the requester's
  private chat with a correction note.
- Verified: 138 tests pass (5 new in `test/replyMatching.test.js`, regression
  reproduces the exact GP message), deployed to VPS, confirmed `POSTED_LIVE`
  on the live correction draft.

## Done — 2026-06-20: Telegram private-DM intake

Authorized users can now message the bot directly (1:1 DM) instead of only
through the shared group, with replies routed back to that same private
chat — useful when a request/reply shouldn't be visible to the whole group.

- `telegram-bridge/bridge.js` `planIntake()`: a message is processed if it's
  from the configured group OR from any private chat (`chat.type ===
  'private'`). Private chats are **always** authorized-only via
  `config.authorizedUsers` — there's no "open" equivalent of group
  membership for a 1:1 chat with the bot. Unauthorized senders (group or
  private) are silently ignored — no reply, ever — consistent with the
  "all authorization failures stay silent" decision from earlier this
  session.
- **Real bug fixed in the same pass**: `handleIntake()`'s ack and
  rejection messages used to hardcode `chatId: config.groupChatId` — a
  private-DM submission's ack/rejection would have been sent to the
  *group*, not back to the requester. Now uses `plan.request.chatId`,
  so replies always go to whichever chat the request actually came from.
- **Closed the audit gap** noted in the previous safeguard work:
  unauthorized attempts (group allowlist rejection, or any unauthorized
  private DM) are now reported once per (chat, sender) to
  `POST /api/telegram/unauthorized-attempt` → `TELEGRAM_UNAUTHORIZED_ATTEMPT`
  audit entry, surfaced as `telegramUnauthorizedAttempts24h` +
  `recentUnauthorizedAttempts` on `/api/dashboard`, with a KPI tile and
  alert banner in the web admin console (mirrors the chat-mismatch
  safeguard pattern).
- **Operational, not code**: to actually let someone use this, get their
  numeric Telegram user ID (e.g. via `@userinfobot`) — see the next entry
  for how to add them without touching the JSON file directly. The user
  must also message the bot first (`/start` or anything) — Telegram never
  lets a bot initiate contact, so being on the allowlist alone doesn't
  make the bot reach out.
- Verified: 128 tests pass, plus a live browser-preview round-trip of the
  new unauthorized-attempt endpoint (KPI tile + alert banner both render
  correctly).

## Done — 2026-06-20: Manage authorized Telegram users from the UI

Adding/removing authorized users no longer requires SSH + hand-editing
`config/telegram.json` — both the web admin console and the Android Admin
App can do it now, same pattern as the Telegram group/operator-hotline
settings added earlier this session.

- `src/settingsStore.js`: `readAuthorizedUsers()`, `writeAuthorizedUser(id,
  name)`, `removeAuthorizedUser(id)` — merge into `authorizedUsers` in
  `config/telegram.json`, preserving every other field/entry.
- New admin-gated endpoints: `POST /api/admin/settings/authorized-users`
  (add/update) and `POST /api/admin/settings/authorized-users/remove`;
  `GET /api/admin/settings` now also returns the current list.
- Web admin console: an "Authorized Telegram Users" block in the Tools tab
  Settings panel — list with per-row Remove buttons, plus an Add form.
- Android Admin App: the same thing, in the Settings screen's
  "OPERATIONAL SETTINGS" panel — dynamically rendered rows with Remove
  buttons, plus the Add form. Verified by screenshot on the A55 (empty
  state and form both render correctly; didn't test an actual add/remove
  against production from the device, since the web-console round-trip
  already proved the same backend logic end-to-end against a local dev
  server).
- Same restart caveat as the group chat ID: adding/removing takes effect
  only after `pm2 restart sms-bridge` — both UIs say so after a save.
- Verified: 133 tests pass (11 in `test/settingsStore.test.js` now, up
  from 6), plus a live browser-preview add → list → remove round-trip.

## Resolved — From 2026-06-19/20 Sessions

All of the following were verified resolved in code during the 2026-06-20
review pass (re-read the relevant source before re-opening any of these):

- **Reply correlation hardening** — `src/store.js` `findActiveRequestForGateway()`
  no longer prioritizes `WAITING_OPERATOR_REPLY` over `NEEDS_MANUAL_REVIEW`/`TIMEOUT`
  candidates; `src/replyAnalyzer.js` `inferReplyFamilies()` + `src/service.js`
  `replyTypeScore()` now refuse to auto-match a reply whose inferred family
  doesn't include the request's actual type (`SMS_REPLY_TYPE_MISMATCH` audit
  instead of a silent wrong-match), for both single-candidate and ambiguous
  multi-candidate cases.
- **Training data** — the five curated `Training Data/Automation/*.xlsx`
  workbooks are the active baseline, built into `data/training-cache/` by
  `src/trainingData.js`. The old self-reinforcing `saveMatchedReplyKeywords()`
  auto-learn-into-baseline mechanism was removed entirely.
- **Self-training storage** — `src/manualReviewStore.js`, capped per request
  type (not globally) at the latest 100 entries, stored under
  `data/manual-review/<TYPE>.json`, wired into `service.js` by default. Never
  feeds back into matching automatically — promotion into the curated
  workbooks is a manual step.
- **Unauthorized rejections silenced in the group** — `telegram-bridge/bridge.js`
  `shouldSuppressGroupReply()` suppresses all three backend-level
  authorization error codes; format/duplicate rejections still post normally.
- **Watchdog alerts no longer fall back to the group** — `sendTelegramWatchdogAlert()`
  in `src/app.js` only sends to `watchdogAlertChatId`, never the main group.

**One small residual gap, low priority (inactive today):** the bridge-level
`authorizedUsers` allowlist rejection still never reaches the backend, so even
though it's silent in the group now, it's also not audit-visible. Moot while
`authorizedUsers: {}` is empty in production config — revisit if that
allowlist is ever turned on.

## Done — 2026-06-20: Telegram chat-mismatch safeguard + authenticated settings

Root cause of the "bridge stopped working" incident: the VPS's
`config/telegram.json` `groupChatId` had drifted from the real group, so
every message was silently logged as "ignored" with no admin-visible signal.
Fixed in two parts:

1. **Safeguard** — `telegram-bridge/start.js`'s loop used to short-circuit
   wrong-chat messages before ever reaching `bridge.js`'s `handleIntake()`/
   `planIntake()`, which already had unused "wrong chat" handling. Consolidated
   onto one path: `handleIntake()` now reports a mismatch once per distinct
   wrong chat id (in-memory dedupe Set owned by the loop) via
   `backendClient.reportChatMismatch()` → `POST /api/telegram/chat-mismatch`
   (admin-key gated) → `TELEGRAM_CHAT_MISMATCH` audit entry, surfaced as a
   `telegramChatMismatches24h` stat and `recentChatMismatches` diagnostic on
   `/api/dashboard`, with a KPI tile + alert banner in the web admin console.
2. **Authenticated settings** — `src/settingsStore.js` provides admin-gated
   read/write for the Telegram group chat id (`config/telegram.json`) and
   per-operator hotline/shortcode numbers (`config/gateways.json`), via
   `GET /api/admin/settings`, `POST /api/admin/settings/telegram-group`, and
   `POST /api/admin/settings/operator-contact`. A "Settings" panel in the web
   admin console's Tools tab provides the input UI (previously only doable by
   SSH-ing into the VPS and hand-editing JSON). Operator shortcode changes
   apply live without a restart; Telegram group changes need
   `pm2 restart sms-bridge` since that's a separate long-lived process that
   reads its config once at startup — the UI says so after saving.

Not done (deliberately out of scope, no Android app changes this pass): the
same settings UI in the Android Admin App. The web admin console route was
chosen as the lower-risk option per "admin app or backend admin console,
whichever."

---

## Quick Start (VPS is always on — no local backend needed)

Backend and Telegram bridge run permanently on the VPS. Nothing to start on your PC.

To deploy code changes:
```bash
bash scripts/deploy.sh
```

To check VPS status:
```bash
ssh root@45.77.240.195
pm2 status
```

---

## Setting Up a New Gateway Phone

1. Install the app via USB: `adb -s <device-id> install -r app-release.apk`
   Or publish OTA via Admin Panel on A55
2. Open app → **Settings** → tap **Gateway & Connection** (Admin Setup lock) → enter PIN:
   - Backend URL: `http://45.77.240.195:3000`
   - Gateway ID: `GP_PHONE_01` / `BANGLALINK_PHONE_01` / `ROBI_PHONE_01`
   - SIM: select correct slot
   - For dual-SIM (A16): also set Secondary Gateway ID = `BANGLALINK_PHONE_01`, Secondary SIM = SIM 2
3. Tap **Save** → **Start**
4. Check VPS logs: `pm2 logs sms-backend --lines 20`

---

## Roadmap (Priority Order)

### P0 — Operational (do first)

- [ ] **Review reply timeout window** — current 15-minute reply window may be too short for some operators (LCL queries can take 4+ minutes at GP alone; Banglalink/Robi may be slower). Evaluate from production data whether 15 min is sufficient or needs tuning per operator.
- [ ] **Add second authorized DM user** — currently only Addl SP Crime & Ops (ID `8914564310`) can DM the bot privately. Add the user's own Telegram ID via the admin console or `POST /api/admin/settings/authorized-users`. Requires `pm2 restart sms-bridge` after adding.
- [ ] **Domain name** — migrate from `licbarishal.duckdns.org` to `opsbarishal.com`. Full plan in `docs/domain-migration-plan.md`. Buy domain first, then DNS + nginx TLS + gateway phone URL update.
- [ ] **Release gateway phone settings from PIN lock** — Backend URL, Gateway ID, SIM slot selection should be freely editable without PIN. Only admin/system settings stay behind PIN: admin API key, secondary gateway ID, test connection, PIN management itself.

### P1 — Security & Access Control

- [ ] **Daily security audit routine** — automated daily health check: gateway connectivity, stuck requests, unmatched SMS count, rejected messages, unauthorized access attempts, disk/memory usage. Posts a digest to a private Telegram chat or admin DM at a fixed time. Catches anomalies (sudden spike in unauthorized attempts, gateway going offline, DB growing too large) before they become incidents.
- [ ] **Web admin login system** — currently admin console is protected only by API key in the request header. Add a proper login page with session tokens, password hashing (bcrypt), and session expiry. Three roles: (1) **admin** — full access including settings, user management, corrections; (2) **operator** — view requests and replies only; (3) **gateway** — phone registration and heartbeat only (already uses gateway secrets, formalize it).
- [ ] **HTTPS for backend API** — gateway phones currently talk to `http://45.77.240.195:3000` (plain HTTP). After domain migration, enforce HTTPS for all API traffic (nginx already terminates TLS for the public host; extend to the API port or unify under one origin).
- [ ] **Rate limiting** — protect the API from brute-force API key guessing and accidental request floods. Simple in-memory rate limiter per IP (e.g., 60 requests/minute for admin endpoints, 120/minute for gateway polling).
- [ ] **API key rotation** — ability to rotate the admin API key and gateway secrets without downtime. New key activates immediately; old key stays valid for a grace period (e.g., 1 hour) so running clients can be updated.
- [ ] **Audit log tamper protection** — current audit log is append-only in SQLite but not cryptographically signed. Add HMAC chain (each entry signs the previous hash) so tampering is detectable.

### P2 — UI/UX Overhaul

- [ ] **Web admin console redesign** — full UI/UX overhaul using modern design tools (21.dev, Google Stitch, Claude design). Current admin console is functional but plain HTML/JS. Target: professional command-center look with real-time updates, dark/light themes, responsive layout, proper data tables with filtering/sorting/export.
- [ ] **Android admin app polish** — increase fidelity against the Stitch design references at `docs/Design/android-admin-stitch/`. Focus areas: typography, spacing, color consistency, loading states, error states, empty states, pull-to-refresh animations, proper Material 3 components.
- [ ] **Android gateway app UI refresh** — match the admin app's visual language. Current gateway app is utilitarian; add status indicators, connection quality display, SMS queue visualization, and cleaner settings flow.

### P3 — Backend Improvements

- [ ] **Nightly DB backup on VPS** — cron job with rotation (keep last 7 days)
- [ ] **Retry failed gateway sends** — exponential backoff when phone HTTP returns error
- [ ] **Teletalk operator** — add `010x` prefix to `domain.js` if needed
- [ ] **Unmatched SMS cleanup** — auto-archive unmatched SMS older than 7 days to keep the count meaningful. Current 2500+ unmatched is mostly spam noise.
- [ ] **Request analytics dashboard** — daily/weekly/monthly request counts by type, operator, requester. Average response times per operator. Helps identify slow operators and heavy users.

### Previously completed

- [x] Robi phone setup — installed v2.3.0, registered on VPS
- [x] SSH key on VPS — passwordless deploy
- [x] MS-NID single-operator routing — routes by MSISDN prefix
- [x] Telegram open-group auth — any group member can submit
- [x] Late reply matching — replies after finalization matched and re-posted
- [x] Multi-operator live posting — NID-MS/IMEI-MS post on first reply, new message per update
- [x] Auto-correct type-token typos — split commands, glued prefixes, `+880` strip, separator strip
- [x] Specific validation error messages — NID/IMEI/MSISDN cross-detection, strict lengths
- [x] Multi-operator reply posting fix — new Telegram message per update
- [x] Open group auth for forwarded messages — any group member can forward, `authorizedUsers` only gates DMs
- [x] Forward-aware tagging — replies tag the group member who forwarded, not the original author

---

## Multi-Operator Live Posting (NID-MS / IMEI-MS) — DONE

**Behaviour (implemented):**
- First operator reply → post immediately to Telegram: GP filled, Robi/BL "pending..."
- Each subsequent reply → **edit** same message in-place
- All done or timed out → final edit → request COMPLETED

**Design decisions:**
1. Duplicate operator reply → update (take latest text)
2. Edit fails >48h → falls back to new threaded message
3. autoApprove=false → reviewer approves first post once; all subsequent edits automatic

**Status lifecycle:** `APPROVED_FOR_POST` → `POSTED_LIVE` → `APPROVED_FOR_EDIT` → `POSTED_LIVE` → ... → `POSTED`

---

## Android Gateway App — Wave 4

- [x] **Battery optimization exemption** — done in v2.0.2
- [x] **SIM phone number in registration** — done in v2.3.0
- [ ] **Idempotency key** on inbound webhook — SIM slot + timestamp + sender hash; backend deduplicates
- [ ] **EncryptedSharedPreferences** for API key storage
- [ ] **compileSdk/targetSdk bump** to 35
- [ ] **Log rotation** — cap Room DB log size on Android

---

## Completed (archive)

- [x] Phase 0 fixes, first E2E test
- [x] SQLite persistence, per-operator dispatches
- [x] Security — admin key, gateway secrets, audit chain
- [x] Telegram bridge — intake, posting, threaded replies, autoApprove
- [x] Android Wave 1 — auth, signing, Gradle wrapper
- [x] Android Wave 2 — SIM picker, READ_PHONE_STATE
- [x] Content-based reply disambiguation, dashboard actions
- [x] Non-blocking concurrent dispatch, payload-in-reply matching
- [x] Training data imported (144 rows)
- [x] Android UI redesign (hero status, stats, SIM switcher, admin dark theme)
- [x] Polling architecture (phone polls VPS every 3s — no push needed)
- [x] Dual-SIM support (BANGLALINK SIM 1 + GP SIM 2 on one phone)
- [x] OTA update system (UpdateChecker, UpdateInstaller, Admin Panel publish)
- [x] Admin Panel on A55 (gateway health dashboard, publish APK)
- [x] /setup web page for admin key creation
- [x] Telegram offset persistence (no messages lost on restart)
- [x] VPS deployment — Vultr Singapore, PM2, Node 22, UFW
- [x] GP E2E test PASSED on VPS
- [x] Banglalink E2E test PASSED on VPS
- [x] Robi E2E test PASSED on VPS
- [x] v2.0.1 — SmsReceiver dual-SIM inbound routing fix
- [x] v2.0.2 — Battery optimization exemption (Samsung kill fix)
- [x] v2.3.0 — SIM phone number registration + admin card display
- [x] MS-NID → RELEVANT_OPERATOR (single operator by prefix)
- [x] Telegram open-group auth (any group member can submit)
- [x] Late reply matching + re-posting (6-hour window)
- [x] One-command deploy script (`scripts/deploy.sh`, passwordless SSH)
- [x] Multi-operator live posting (NID-MS, IMEI-MS) — post on first reply, new message per update
- [x] Auto-correct type-token typos (`MS NID` → `MS-NID`, glued prefixes, `+880` strip, separator strip)
- [x] Specific validation errors (NID/IMEI/MSISDN cross-detection, digit count, strict lengths)
- [x] Multi-operator reply: new Telegram message per update instead of editing in-place
