# Progress Tracker

Last updated: **2026-06-29 — diagnosed retried-request reply auto-matching bug**

---

## Current Stage

Production backend flow remains live. Most recent work was front-end/asset
only (insignia branding, desktop layout, light-mode fix) — see `todo.md`'s
top entry for the full five-commit breakdown
(`2f1a0c5`, `df996d1`, `8a5278d`, `cee612f`, `edfcd59`). Verified: VPS file
hashes match git HEAD byte-for-byte after the final deploy; both pm2
processes online; 142 tests pass.

**Open item**: `support@opsbarishal.com` is listed on the public Contact
tab but is not yet a live mailbox — create it before officers rely on it.

Earlier this session: group auth was too restrictive — adding a user to
`authorizedUsers` (for private-DM gating) had closed the group to all
non-whitelisted members. Fixed: group chat is now always open; `authorizedUsers`
only gates private DMs. Forwarded-message replies now tag the forwarder
(`message.from`), not the original author (stored as `forwardedFrom` for audit).

Git and the live VPS should be kept in sync after each deploy from this branch.

## Documentation Baseline

Use these Markdown files as the active continuity baseline:

- `README.md`
- `progress_tracker.md`
- `todo.md`
- `docs/training-and-matching-rules.md`
- `docs/PHONE_GATEWAY_CONTRACT.md`
- `android-gateway/README.md`

---

## Session Handoff (2026-06-29) — diagnosed retried-request reply auto-matching bug

### What was diagnosed

**Incident:** REQ-20260629-0694-28U1 (MS-NID 01846234464 to ROBI):
- Request timed out at 15:45, TIMEOUT posted to Telegram
- User manually retried request
- Operator replied (MSISDN 8801846234464, NID 4667103669, DoB 10/17/2004)
- ✅ Reply received and stored in unmatched SMS inbox
- ❌ Auto-matcher failed to link it to the original request
- ❌ Reply never posted to Telegram (requires manual matching in admin dashboard)

**Root cause:** When `retryRequest()` is called, request status is set to `QUEUED`, then dispatched.
`findActiveRequestForGateway()` only checks `WAITING_OPERATOR_REPLY`, `NEEDS_MANUAL_REVIEW`, and `TIMEOUT` (within 1 hour).
If the request transitions to a non-matchable status before the operator's late reply arrives, the auto-matcher won't find it.

**Workaround (immediate):** Manually match the reply in admin dashboard via `rankReplyCandidates()` + `correctMatch()`.

**Fix (required):** Extend reply window for retried requests (currently 1h for TIMEOUT, should be 2h for retried). See `todo.md` for details.

### Important files

- `src/service.js` — `retryRequest()` function at line ~545
- `src/store.js` — `findActiveRequestForGateway()` function (reply window logic)
- `todo.md` — comprehensive bug write-up with fix checklist

### Verified

- Both bridge and backend processes running correctly
- Reply matching system works for direct (non-retried) timed-out requests
- Manual correction workflow (`rankReplyCandidates` + `correctMatch`) successfully re-matches orphaned replies

---

## Session Handoff (2026-06-23) — open group auth + forward-aware tagging

### What changed

1. **Group chat is now open regardless of `authorizedUsers`** — the
   `authorizedUsers` whitelist in `config/telegram.json` previously gated both
   private DMs and group submissions. Adding even one entry (needed for DM
   access) closed the group to all non-whitelisted members. Officers forwarding
   requests from colleagues were silently rejected (`shouldSuppressGroupReply`
   suppressed the auth error). Fixed: `planIntake()` in `bridge.js` no longer
   checks `authorizedUsers` for group-chat messages — any group member can
   submit. Private DM authorization is unchanged.

2. **Forwarded message tagging** — `planIntake()` now detects `forward_from` /
   `forward_sender_name` on incoming messages and stores the original author as
   `forwardedFrom` metadata on the request. The reply always tags `message.from`
   (the group member who forwarded), never the original author. Log line now
   includes `[fwd from: X]` for forwarded messages.

3. **Recovered 3 silently rejected requests** — manually resubmitted via the
   backend API:
   - `REQ-20260622-0285-MPLU`: `IMEI-MS` with 4 IMEIs (originally from SI Nazmul Bakerganj, forwarded by Bakerganj Circle)
   - `REQ-20260622-0286-V7IQ`: `LCL 01726956407`
   - `REQ-20260622-0287-I12L`: `LRL 01726956407`

### Important files

- `telegram-bridge/bridge.js` — `planIntake()` group auth removed, `forwardedFrom` metadata added
- `test/telegramBridge.test.js` — 19 tests (was 17), new tests for forwarded message tagging

### Test results

19 bridge tests pass. Full suite not re-run (only `bridge.js` changed).

### Deployed

- `bridge.js` deployed via `scp` + `pm2 restart sms-bridge`
- Backend unchanged this session

---

## Session Handoff (2026-06-20 night) — reply-type misclassification incident

### What happened

A requester sent `LRL 01718589986` via private Telegram DM. An unrelated GP reply
("Sorry No records found for IMEI: 353917104327090 [GP]") arrived first and was
auto-matched to the LRL request, which was then approved and posted — wrong
answer delivered. Two minutes later the real LRL reply (with full location data)
arrived, found nothing left to attach to, and was silently dropped as unmatched.

### Root cause

`replyAnalyzer.js`'s strong-type detection regexes for IMEI/NID replies were
line-anchored (`(?:^|\n)\s*imei[:\s]`), so they never matched GP's actual "no
records found" template, which embeds the keyword mid-sentence. The reply
scored as type-neutral, and the single-pending-request fallback (payload-blind
by design) accepted it since it was the only open request on that gateway.

### Fix (deployed, tested)

- `src/replyAnalyzer.js`: added unanchored fallback patterns for IMEI/NID
  "no records found" replies so they're correctly type-tagged regardless of
  position in the message.
- `src/service.js`: added `rankReplyCandidates(inboxId)` (ranks every plausible
  request — including already-`COMPLETED` ones — using the same scoring as
  live auto-matching) and `correctMatch(inboxId, requestId)` (re-attaches an
  orphaned reply to the correct request, detaches any wrongly-matched inbox
  row for that request/gateway, and issues a new `⚠️ Correction —` reply draft
  instead of silently rewriting history).
- `src/app.js`: `GET /api/admin/unmatched/:id/candidates`,
  `POST /api/admin/correct-match` (both admin-gated).
- `public/admin.js`: the unmatched-SMS panel's manual-match dropdown now shows
  ranked candidates with scores (including completed ones, labeled "correction")
  instead of a flat unranked list.
- `test/replyMatching.test.js` (new, 5 tests): regression test reproducing the
  exact GP message, plus coverage for `rankReplyCandidates`/`correctMatch`.
- Tonight's actual stuck production request (`REQ-20260620-0118-D5UQ`) was
  corrected live via the new endpoint — the real LRL answer was posted to the
  requester's private chat with a correction note.

### Verified

- `node --test` across all 8 test files: 138/138 passing (was 133 before this
  session; +5 new in `test/replyMatching.test.js`).
- Deployed via `bash scripts/deploy.sh`; confirmed `pm2 status` online for both
  `sms-backend` and `sms-bridge`.
- Confirmed via the dashboard API that the correction reply draft reached
  `sentStatus: POSTED_LIVE` with a real `postedMessageId`.

---

## Session Handoff (2026-06-20)

### What changed

Reply matching and safety:

- wrong-request reply attachment was hardened in backend correlation logic
- family confusion such as `LRL` vs `LCL` and `MS-NID` vs `IMEI-MS` is handled more cautiously
- ambiguous replies now fall to review more readily instead of forcing an auto-match
- authorization-style failure messages are no longer posted back into the shared Telegram group
- watchdog unauthorized-send alerts no longer fall back into the group chat

Training-data strategy:

- the five curated workbooks in `Training Data/Automation/` are now the active manual baseline
- runtime matching uses generated cache files in `data/training-cache/`
- old single-file `data/reply-patterns.json` is no longer the runtime source
- automatic self-training into the curated baseline is disabled
- review-only examples can be stored separately in `data/manual-review/` with a cap of 100 entries per request type

Android inbound retry:

- retries now preserve original `gatewayId`
- full inbound SMS body is retained
- original receive timestamp is retained
- Android sends a deterministic `deliveryKey`
- backend deduplicates repeated inbound webhook retries

### Current test status

Verified in this session:

- `node --test test\workflow.test.js test\telegramBridge.test.js test\trainingData.test.js test\manualReviewStore.test.js`
- result: `95/95` passing
- Android build: `android-gateway\gradlew.bat :app:assembleDebug`
- result: build successful when `JAVA_HOME` points to `C:\Program Files\Android\Android Studio\jbr`

### Important files from this hardening pass

- `src/parser.js`
- `src/replyAnalyzer.js`
- `src/service.js`
- `src/store.js`
- `src/trainingData.js`
- `src/manualReviewStore.js`
- `telegram-bridge/bridge.js`
- `android-gateway/app/src/main/java/com/smsgateway/SmsReceiver.kt`
- `android-gateway/app/src/main/java/com/smsgateway/WebhookSender.kt`
- `android-gateway/app/src/main/java/com/smsgateway/RetryWorker.kt`
- `android-gateway/app/src/main/java/com/smsgateway/db/AppDatabase.kt`

### Current caution

- Android lint may still fail on this workstation if Google Maven SSL trust is broken locally
- the deploy script must include newer backend support files such as training-cache/manual-review logic
- remaining non-critical review follow-ups still include `src/app.js` audit-call cleanup and Telegram offset cold-start resilience

---

## Environment

| Component | Location | Notes |
|-----------|----------|-------|
| Backend | `45.77.240.195:3000` | Vultr Singapore VPS |
| Public host | `https://licbarishal.duckdns.org` | Admin API reachable here — **planned migration to `opsbarishal.com`, see `docs/domain-migration-plan.md`** |
| Android JDK | `C:\Program Files\Android\Android Studio\jbr` | verified for local build |

---

## Next Recommended Steps

1. Keep curated workbook examples up to date in `Training Data/Automation/`
2. Review `data/manual-review/*.json` periodically before promoting any examples into curated workbooks
3. Continue with the remaining backend review issues after deploy
