# Progress Tracker

Last updated: **2026-06-20 - matching hardening, curated training cache, Android inbound retry fix**

---

## Current Stage

Production backend flow remains live. The latest hardening pass focused on three areas:

1. request intake is still operator-hardbound at dispatch time, but now lightly normalized at intake for safe formatting mistakes
2. reply matching is now anchored more tightly by request family, payload evidence, curated workbook-derived caches, and manual-review fallback
3. Android inbound webhook retry now preserves original reply identity and backend deduplicates delayed resends after temporary internet loss

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
| Public host | `https://licbarishal.duckdns.org` | Admin API reachable here |
| Android JDK | `C:\Program Files\Android\Android Studio\jbr` | verified for local build |

---

## Next Recommended Steps

1. Keep curated workbook examples up to date in `Training Data/Automation/`
2. Review `data/manual-review/*.json` periodically before promoting any examples into curated workbooks
3. Continue with the remaining backend review issues after deploy
