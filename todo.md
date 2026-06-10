# Todo

Context for any developer continuing this project. **Start with `progress_tracker.md`** for the 2026-06-11 session handoff (IPs, test results, dual-SIM fix, office checklist).

See `README.md` for architecture and quick start.

---

## Office PC — First Actions Tomorrow

- [ ] `git pull` / sync repo to office machine
- [ ] Run `start-backend.bat` — write down printed **LAN IP** (will differ from home `192.168.0.230`)
- [ ] Confirm phone and PC on **same Wi‑Fi**
- [ ] Open app → **Backend: connected** (or set Backend URL to `http://<office_PC_IP>:3000`)
- [ ] **Start Service** on A55 → verify dashboard shows GP `gatewayUrl` = `http://<phone_ip>:8080`
- [ ] Confirm **default SMS SIM** is working GP SIM (not “Emergency only” slot) — see `progress_tracker.md` § Dual SIM
- [ ] Optional: repeat Test Request → manual reply → dashboard draft (backend restart wipes in-memory data)

---

## Phase 0 — Code Review Fixes (Done)

- [x] **apiKey dropped** — `store.js` copies `apiKey`; `smsGateway.js` sends `Authorization: Bearer`
- [x] **Requester auth no-op** — `upsertUser` preserves existing `role`/`allowedOperators`
- [x] **Timeout from createdAt** — timeout/reply window uses latest `smsOutbox.sentAt`
- [x] **Queue stalls after timeout** — `timeoutWaitingRequests()` calls `dispatchNext`
- [x] **Manual timeout only** — server runs automatic sweep every 60s (`TIMEOUT_SWEEP_MS` env)
- [x] **Request ID collision on restart** — random suffix (`REQ-YYYYMMDD-0001-AB12`)
- [x] **Alphanumeric sender matching** — trusted branded senders match without destination equality

---

## Immediate (Testing / Bugs)

- [x] Fix Android **Start Service** crash — `dataSync` / `remoteMessaging`, notification fixes, always `startForeground()` (v1.1.4)
- [x] Verify Start Service on user device — **works on A55** (2026-06-11)
- [x] Complete first end-to-end test — **REQ-20260610-0002-P94E** → `NEEDS_MANUAL_REVIEW` + WhatsApp draft
- [x] `trustedSenders` includes test reply number `01936759367` (GP block in `config/gateways.json`)
- [x] Backend auto-discovery from phone — **v1.2.1** (priority scan 200–254, 1s timeout)
- [x] Dynamic gateway registration — `POST /api/gateways/register` on Start Service
- [x] `start-backend.bat` / `stop-backend.bat` reliable on Windows
- [x] `config/gateways.json` valid JSON — GP `gatewayUrl` can be `""` for auto-register
- [ ] **SIM slot picker** in Android app — A55 dual-SIM sent via dead slot → `resultCode: 4` No service
- [ ] **SMS delivery callbacks** — app returns `ok: true` before carrier confirms; log `FAILED` in Room + backend
- [ ] Document office PC LAN IP + phone IP in local notes when testing at office (IPs change per network)
- [ ] Re-run E2E at office after network change
- [ ] Approve draft on dashboard and manually post to real WhatsApp group (copy/paste workflow)

---

## Android Gateway App (`android-gateway/`)

### Done
- Kotlin app with NanoHTTPD `POST /send-sms`, SMS send/receive, webhook forward, retry queue, Room logs
- Foreground service + boot receiver (v1.1.4 stable)
- Settings (gateway ID, backend URL, port, test metadata)
- Test Request panel (type, payload, target number → backend `testDestination`)
- Dark Material UI, backend health check, copy IP
- **BackendDiscovery** auto-scan subnet for `/api/health` (v1.2.1)
- **BackendClient** fast discovery health check + validates `service: sms-whatsapp-automation`
- Signed release APK — **v1.2.1** (`versionCode` 8)
- `build-apk.bat` with full Gradle/JDK/SDK paths

### Next (priority)
- [ ] **SIM slot / subscription ID** setting — use `SmsManager.getSmsManagerForSubscriptionId()` for dual-SIM phones
- [ ] `PendingIntent` sent/delivery callbacks — update log status `OK` → `FAILED` when carrier rejects
- [ ] Show last SMS carrier result on main screen (not just “queued”)
- [ ] In-app error toast when service fails (port in use, permission denied)
- [ ] Phone health endpoint (`GET /health` on phone) for backend dashboard
- [ ] Battery optimization exemption prompt (Samsung kills background services)
- [ ] Settings UI for Test Metadata (WhatsApp group ID, requester name) — fields exist; document real values for production group
- [ ] Move keystore path out of hardcoded `C:\BuildTools\` → project-local or env
- [ ] Fix GitHub Actions APK build (ANDROID_HOME conflict; local `build-apk.bat` works)

### Known device issue (A55)
- Dual GP SIMs: slot 0 (subId 2) works, slot 1 (subId 1) “Emergency only”
- `defaultSmsSubId=1` caused all SMS failures until user changed SMS default in SIM manager
- Workaround: phone Settings → SIM manager → SMS → working SIM
- Permanent fix: SIM picker in app (above)

---

## Backend (`src/`)

### Done
- Request parsing, routing, queues, mock/HTTP gateway, inbound webhook, reply analyzer, dashboard
- `GET /api/health` — includes `preferredLanIp`, `lanAddresses`, `backendUrls`
- `POST /api/gateways/register` — phone registers `{ gatewayId, host, port }`
- `src/network.js` — LAN IP detection (prefers Wi‑Fi, skips NordVPN/Tailscale)
- `testDestination` support for pre-launch testing
- `normalizePhoneNumber()` for trusted sender and request matching
- `start-backend.bat`, `stop-backend.bat`, `scripts/get-lan-ip.ps1`, `scripts/stop-backend-port.ps1`, `scripts/ensure-firewall-3000.ps1`
- Server binds `0.0.0.0` for LAN access
- **18/18** tests pass (`node --test`)

### High Priority
- [ ] Replace in-memory storage with SQLite (`db/schema.sql`)
- [ ] Structured reply extractors per request type + operator (replace keyword confidence)
- [ ] Authentication and user roles on API
- [ ] Manual review actions: reject, retry, timeout (approve exists)
- [ ] Retry logic for failed phone gateway HTTP sends
- [ ] Gateway config UI on dashboard (phone URLs, trusted senders)
- [ ] Surface SMS delivery failure if phone app adds sent callbacks

### Medium Priority
- [ ] Phone health checks in dashboard (online/offline, last seen)
- [ ] Export/reporting for audit logs and request history
- [ ] Alerting for stuck queues and timeout spikes
- [ ] Persist `testDestination` flag clearly in request object for audit
- [ ] Store `whatsappGroupId` on draft row for future WhatsApp API posting

---

## WhatsApp

- [x] Draft format with `@requesterName` tag — see `formatWhatsAppReply()` in `src/service.js`
- [ ] Keep manual WhatsApp posting during MVP (no API wired yet)
- [ ] Set real values in app Settings → Test Metadata when using production group:
  - WhatsApp Group ID (for future API — currently `test-whatsapp-group`)
  - Requester Name (becomes `@Name` in draft)
  - Requester WhatsApp ID (auth only today)
- [ ] Evaluate official WhatsApp Business API before automatic group posting
- [ ] Dashboard “Copy for WhatsApp” button (nice-to-have)

---

## Training Data

- [ ] Review and fill blank reply rows in Excel files
- [ ] Add tonight's real GP LRL reply as reference sample in training set
- [ ] Confirm each row is in correct request-type/operator folder
- [ ] Add more real examples for `MS-NID` and `NID-MS`
- [ ] Convert imported examples into field extraction tests
- [ ] Run `npm run import:training` after every training-data update

---

## Test Checklist (validated 2026-06-11 — repeat at office)

1. [x] PC: run `start-backend.bat`, note LAN IP
2. [x] PC: `config/gateways.json` — GP `gatewayUrl` `""` or phone IP; `trustedSenders` includes reply numbers
3. [x] Phone: install APK **v1.2.1+**, grant SMS + notifications
4. [x] Phone: Settings → `GP_PHONE_01`, Backend URL blank or `http://<PC_IP>:3000`, port `8080`
5. [x] Phone: default SMS SIM = working GP SIM (dual-SIM check)
6. [x] Phone: Start Service → RUNNING, Backend connected
7. [x] Phone: Test Request → `LRL`, payload `01724761972`, target `01936759367`
8. [x] Target phone receives SMS `LRL 01724761972`
9. [x] Manual reply from target → gateway forwards to backend
10. [x] Dashboard: `NEEDS_MANUAL_REVIEW` + WhatsApp draft with `@Test User`
11. [ ] Dashboard: Approve draft → manually paste to WhatsApp group

---

## Suggested Build Order (for next dev session)

1. SIM slot picker + SMS delivery callbacks on Android (fixes false-positive SENT)
2. Re-test E2E on office network
3. Wire SQLite persistence (`db/schema.sql` → replace `AutomationStore`)
4. Structured reply extractors using `data/reply-patterns.json` + tonight's GP LRL sample
5. Dashboard improvements (copy draft, reject/retry)
6. Production hardening: auth, health monitoring, WhatsApp integration evaluation
