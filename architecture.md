# Architecture

System design for the SMS Automation bridge. This document describes both the **current implementation** and the **target architecture**; differences are marked. For the phased roadmap see `PROJECT_PLAN.md`.

---

## 1. Purpose

Authorized users in a WhatsApp group submit formatted lookup requests (LRL, LCL, MS-NID, NID-MS, IMEI-MS). The backend routes each request through the correct operator gateway phone (GP / Robi / Banglalink SIM), the operator push-pull service replies by SMS to that same SIM, the reply is matched back to the original request, and a WhatsApp-ready draft (tagging the original requester) is produced for manual review and posting.

## 2. Topology

```text
┌──────────────────────┐
│  WhatsApp Group       │  (manual intake during MVP; official API later)
└──────────┬───────────┘
           │ request text + requester identity
           ▼
┌──────────────────────┐        ┌────────────────────────────┐
│  Backend (Node.js)    │◄──────►│  Dashboard (public/)        │
│  PC on LAN, port 3000 │        │  review, approve, monitor   │
└──┬───────────────▲───┘        └────────────────────────────┘
   │ POST /send-sms │ POST /api/sms/inbound
   ▼                │
┌──────────────────┴───────────────────────────┐
│  3 × Android Gateway Phones (Kotlin app)      │
│  GP_PHONE_01 · ROBI_PHONE_01 · BL_PHONE_01    │
│  NanoHTTPD :8080 · SmsManager · SmsReceiver   │
└──────────────────┬───────────────────────────┘
                   │ SMS (mobile network, never internet)
                   ▼
       Operator push-pull shortcodes
```

All HTTP traffic is LAN-only (PC and phones on the same Wi-Fi). SMS to operators is exactly `REQUEST_TYPE VALUE` — never altered, no backend references appended.

## 3. Components

### 3.1 Backend (`src/`)

| Module | Responsibility |
|--------|----------------|
| `server.js` | HTTP server, binds `0.0.0.0:3000` |
| `app.js` | Routing, JSON handling, static dashboard files, `/api/gateways/register` |
| `network.js` | LAN IP detection for health endpoint (prefers Wi‑Fi, skips VPN adapters) |
| `service.js` | Orchestration: submit, inbound webhook, approve, timeout |
| `parser.js` | Strict request-format parsing + validation messages |
| `domain.js` | Operators, request types, status machine, phone normalization |
| `queue.js` | Per-operator FIFO; one active request per operator phone |
| `smsGateway.js` | HTTP client to phone gateways (mock mode when no URL) |
| `store.js` | Data store (currently in-memory; target: SQLite per `db/schema.sql`) |
| `replyAnalyzer.js` | Reply pattern matching against training data + fallback regexes |
| `config.js` | Loads `config/gateways.json` (gitignored) |

### 3.2 Android Gateway (`android-gateway/`)

One APK for all three phones; identity (`gatewayId`) set in Settings per device.

- **Backend → Phone:** `POST /send-sms` (NanoHTTPD on :8080) → `SmsManager` sends from the SIM
- **Network → Phone:** `SmsReceiver` catches inbound SMS
- **Phone → Backend:** OkHttp `POST /api/sms/inbound`; WorkManager retries on failure
- Foreground service (`dataSync` + `remoteMessaging`), Room DB activity log, boot receiver
- **Backend discovery (v1.2.1):** scans phone subnet for `GET /api/health`, validates `service: sms-whatsapp-automation`
- **Gateway registration:** on Start Service, `POST /api/gateways/register` updates backend `gatewayUrl` in memory
- **Dual-SIM caveat:** `SmsSender` uses default SMS SIM — wrong SIM selection causes carrier `No service` failures

Contract: `docs/PHONE_GATEWAY_CONTRACT.md`.

### 3.3 Dashboard (`public/`)

Snapshot view of gateways, requests, outbox/inbox, drafts, audit log; approve action. Target: full review actions (reject, retry, manual match), gateway config editor, phone health.

## 4. Request Types and Routing

| Type | Payload | Routed to |
|------|---------|-----------|
| `LRL`, `LCL` | MSISDN | Single operator by prefix (GP 013/017, Robi 016/018, BL 014/019) |
| `MS-NID`, `NID-MS`, `IMEI-MS` | MSISDN / NID / IMEI | **All three** operators (fan-out) |

## 5. Data Model

### Current (in-memory) and `db/schema.sql`

`users`, `operator_gateways`, `requests`, `sms_outbox`, `sms_inbox`, `whatsapp_replies`, `audit_logs`.

### Per-operator dispatches (implemented, Phase 1)

A fan-out request (e.g. `NID-MS`) previously shared **one** status across three operators, which conflated states (one operator replied, another timed out). This is now split into one dispatch row per target operator (`src/persistence.js`, `request_dispatches`):

```sql
CREATE TABLE request_dispatches (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(request_id),
  operator TEXT NOT NULL,           -- GP | ROBI | BANGLALINK
  gateway_id TEXT NOT NULL,
  status TEXT NOT NULL,             -- QUEUED | SENT | WAITING_REPLY |
                                    -- REPLY_RECEIVED | TIMEOUT | FAILED
  outbox_id TEXT,
  inbox_id TEXT,
  sent_at TEXT,
  replied_at TEXT,
  UNIQUE (request_id, operator)
);
```

Request-level status is **derived**: `NEEDS_MANUAL_REVIEW` when every dispatch is terminal (`REPLY_RECEIVED`/`TIMEOUT`/`FAILED`) and at least one reply arrived; `TIMEOUT` only when all dispatches timed out; `FAILED` otherwise. Timeouts are computed per-dispatch from the linked outbox `sent_at`, **not** the request `created_at` (a request that waited in queue still gets a full reply window). See `_finalizeIfTerminal` and `timeoutWaitingRequests` in `service.js`. Fan-out finalization produces one combined draft via `formatCombinedReply`.

## 6. Request Lifecycle

```text
RECEIVED → VALIDATED → QUEUED → SMS_SENT → WAITING_OPERATOR_REPLY
   → REPLY_RECEIVED → NEEDS_MANUAL_REVIEW → WHATSAPP_REPLY_POSTED → COMPLETED
Failure exits: FAILED, TIMEOUT (terminal)
```

Transitions are enforced by `assertTransition()` in `domain.js`. Target: per-dispatch sub-lifecycle as in §5, request status derived.

## 7. Queue Policy (critical safety rule)

Operator replies usually contain **no reference ID**, so matching relies on "only one in-flight request per operator phone":

1. Each operator has a FIFO queue.
2. `dispatchNext(operator)` sends the head of the queue **only if** no request is currently active (SENT / WAITING / REPLY_RECEIVED / NEEDS_MANUAL_REVIEW) on that operator's phone.
3. The next request dispatches only after the active one completes, fails, or times out.
4. **Every** event that frees an operator slot (approve, reject, timeout, failure) must trigger `dispatchNext` for that operator — otherwise the queue stalls.

The `silentReference` (`SR…`) exists backend-side only and is never put in the SMS. Reference-based matching in `findActiveRequestForGateway` is a forward-compatibility path for operators that echo references; in practice matching uses gateway + trusted sender + single-pending + time window.

## 8. Reply Matching

Inbound SMS is processed only if the sender is in the gateway's `trustedSenders` (normalized via `normalizePhoneNumber`, which handles the `880`→`0` prefix). Matching order:

1. Silent reference found in body and request was sent from this gateway (rare; future).
2. Exactly one pending request on this gateway whose **outbound destination equals the reply sender**, within the reply window.
3. Otherwise: stored as unmatched → manual review on dashboard.

**Known gap (target fix):** operators sometimes reply from an alphanumeric sender ID different from the shortcode the SMS was sent to. Matching should fall back to *trusted sender + single pending request on the gateway* even when sender ≠ destination, since trust is already established by configuration.

## 9. Reply Analysis

`replyAnalyzer.js` scores each matched reply:

- Built-in regex patterns per request type (location / NID / MSISDN keywords)
- Training-derived keywords from `data/reply-patterns.json` (imported from `Training Data/Automation/*.xlsx` via `npm run import:training`)
- Confidence: HIGH (reference+pattern) / MEDIUM (reference) / LOW (pattern) / UNKNOWN

Target: **structured field extractors** per (operator, request type) that pull named fields (MSISDN, NID, IMEI, IMSI, lat/long, cell/LAC, address, dates) into the draft, with the raw operator text always preserved verbatim below the extracted fields.

## 10. WhatsApp Reply Drafting

Every matched reply produces a draft tagging `@requesterName` with request ID, type, operator, payload, raw operator response, confidence note, and Dhaka-timezone timestamp. Drafts stay `DRAFT` until manually approved (`POST /api/whatsapp-replies/:id/approve`).

Target for fan-out requests: one **combined draft** assembled when all dispatches are terminal (per-operator sections, missing operators marked "no reply / timeout"), instead of independent per-operator drafts where only the latest gets posted.

WhatsApp posting stays **manual** (copy from dashboard) until an official, policy-safe WhatsApp Business integration is validated. Unofficial WhatsApp Web automation is explicitly out of scope.

`whatsappGroupId` is stored on each request (from app Settings → Test Metadata, default `test-whatsapp-group`) but is **not used to post** in the current MVP. The draft's `@requesterName` line uses `requesterName` (plain text), not a WhatsApp JID mention.

**E2E validated 2026-06-11:** test mode with `testDestination`, manual reply, draft with `NEEDS_MANUAL_REVIEW`. Details in `progress_tracker.md`.

## 11. Security Model

| Boundary | Implementation (Phase 2) |
|----------|--------------------------|
| Dashboard / backend API | Admin API key (`x-api-key` / Bearer); empty key = dev mode. `src/auth.js`, `config/auth.json` |
| Phone → backend webhook + registration | Per-gateway shared secret (`x-gateway-secret`); unsigned posts rejected. `requireGatewayAuth` strict mode |
| Backend → phone `/send-sms` | `Authorization: Bearer <apiKey>` sent per gateway (phone-side rejection = Android TODO) |
| Requester authorization | Persistent `users.allowedOperators` + roles; `denyUnknownRequesters` deny-by-default; DISABLED users blocked; admin user management API |
| Audit | Persistent, append-only, **SHA-256 hash-chained** (tamper-evident); `GET /api/audit/verify`, CSV export |
| Secret exposure | Gateway `secret`/`apiKey` stripped from dashboard snapshot |

Invariants (from `vision.md`):

1. Operator SMS commands are sent **exactly** as formatted — never modified.
2. Only configured trusted senders are analyzed.
3. One active request per operator phone unless reference matching is reliable.
4. Requester identity is preserved from intake to final tagged reply.
5. Manual review before anything is posted to WhatsApp.

## 12. Failure Modes and Recovery

| Failure | Handling (current → target) |
|---------|------------------------------|
| Phone unreachable | Send fails, request FAILED → retry with backoff, alert, keep queued |
| Backend down when SMS arrives | Phone WorkManager retries webhook (done) |
| Backend restart | All state lost → SQLite persistence, request-ID sequence restored from DB |
| Operator never replies | Manual `/api/timeouts/run` → scheduled timeout sweep + auto-dispatch next |
| Reply from unknown sender | Ignored + audited (done) |
| Multiple pending on one phone | Match refuses ambiguity → manual review (done; keep) |
| Phone battery-killed service | — → battery-optimization exemption prompt, heartbeat + offline alert on dashboard |
| Dual-SIM wrong default SMS slot | Carrier `RESULT_ERROR_NO_SERVICE`; Samsung Messages shows failed — set SMS default SIM in phone settings; target: SIM picker in app |
| App reports SENT before carrier delivers | Backend outbox `SENT` when phone HTTP returns ok — target: sent-intent callbacks from `SmsManager` |
| Backend/phone on different subnets | Auto-discovery fails — set Backend URL manually or same Wi‑Fi |

## 13. Testing Strategy

- Unit/integration: `node --test` over the service harness (`test/workflow.test.js`) — keep growing with every defect fixed.
- Extractor tests generated from training-data rows (expected fields per real reply).
- End-to-end test mode: `testDestination` on `POST /api/requests` sends to a real phone you control, which replies manually; its number is added to `trustedSenders`. This validates the full loop without touching operator shortcodes.
