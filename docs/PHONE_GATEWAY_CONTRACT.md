# Android Phone SMS Gateway Contract

Each Android phone exposes a local HTTP endpoint for sending SMS and forwards incoming SMS to the backend webhook. The backend can discover phones via runtime registration or static `config/gateways.json`.

See `progress_tracker.md` for validated E2E test (2026-06-11) and dual-SIM notes.

---

## Phone Roles

| Device | Gateway ID | SIM |
|--------|------------|-----|
| GP phone | `GP_PHONE_01` | Grameenphone |
| Robi phone | `ROBI_PHONE_01` | Robi |
| Banglalink phone | `BANGLALINK_PHONE_01` | Banglalink |

One APK for all phones — set Gateway ID in Settings per device.

---

## Discovery and Registration

### Backend health (phone → PC)

```http
GET http://<PC_LAN_IP>:3000/api/health
```

Example response:

```json
{
  "ok": true,
  "service": "sms-telegram-automation",
  "version": "0.1.0",
  "port": 3000,
  "preferredLanIp": "192.168.0.230",
  "lanAddresses": ["192.168.0.230"],
  "backendUrls": ["http://192.168.0.230:3000"]
}
```

Android app (v1.2.1+) scans the phone's Wi‑Fi subnet for this endpoint when Backend URL is blank.

### Gateway registration (phone → PC)

When the foreground service starts, the phone registers its HTTP listen address:

```http
POST http://<PC_LAN_IP>:3000/api/gateways/register
Content-Type: application/json

{
  "gatewayId": "GP_PHONE_01",
  "host": "192.168.0.172",
  "localIp": "192.168.0.172",
  "port": 8080
}
```

Response:

```json
{
  "ok": true,
  "gateway": {
    "id": "GP_PHONE_01",
    "gatewayUrl": "http://192.168.0.172:8080",
    "status": "CONFIGURED",
    "lastSeenAt": "2026-06-10T21:11:26.286Z"
  }
}
```

Backend updates `gatewayUrl` **in memory** (and displays it for diagnostics —
gateway `status` shows `CONFIGURED` vs `MOCK` based on whether it's set). Restart
backend → phone must Start Service again (or set `gatewayUrl` manually in
`config/gateways.json`).

`config/gateways.json` may use `"gatewayUrl": ""` for GP to rely on auto-registration.

**`gatewayUrl`/`sendPath` are not actually used to send anything today.** The
backend never makes an outbound HTTP call to the phone — see the poll-based
contract below. These fields exist for the gateway health display only; an
earlier "push" design called `POST http://<PHONE_IP>:8080/send-sms` directly,
but that path is dead code on the backend side now.

### Heartbeat (phone → PC)

```http
POST http://<PC_LAN_IP>:3000/api/gateway/heartbeat
Content-Type: application/json
x-gateway-secret: <per-gateway secret>

{ "gatewayId": "GP_PHONE_01" }
```

Response:

```json
{ "ok": true, "gateway": { "id": "GP_PHONE_01", "lastSeenAt": "2026-06-18T11:31:15.401Z" } }
```

Added so the dashboard's `lastSeenAt` (and the "online/offline" gateway health
chip) stays current even when a gateway has no outgoing jobs to poll for —
polling `/api/gateway/jobs` also refreshes `lastSeenAt` as a side effect, but a
quiet operator with no pending requests could otherwise look stale/offline for
no real reason. The Android app calls this every 30s from the same poll-loop
thread that calls `/api/gateway/jobs` ([`GatewayForegroundService.kt`](../android-gateway/app/src/main/java/com/smsgateway/GatewayForegroundService.kt)).

---

## Backend ↔ Phone: Send SMS (poll-based — this is the real contract)

The phone never receives a push from the backend. Instead it polls every 3
seconds from a background thread inside the foreground service
([`GatewayForegroundService.kt`](../android-gateway/app/src/main/java/com/smsgateway/GatewayForegroundService.kt)),
claims any waiting jobs, sends them via `SmsManager`, then acks the result.

### 1. Poll and claim (phone → PC)

```http
GET http://<PC_LAN_IP>:3000/api/gateway/jobs?gatewayId=GP_PHONE_01
x-gateway-secret: <per-gateway secret>
```

Atomically claims every `PENDING_PICKUP` outbox row for that gateway (sets
status `CLAIMED`, records `claimedAt`) and returns them:

```json
{
  "jobs": [
    {
      "outboxId": "outbox_8mrrs9xw",
      "to": "01714054239",
      "message": "LRL 01724761972 01799999999",
      "requestId": "REQ-20260610-0002-P94E",
      "operator": "GP"
    }
  ]
}
```

- `message` is the canonical dispatch text built by `src/parser.js` — sent
  **exactly** as-is, no backend metadata appended. Since the multi-number
  batching work, this may contain up to 5 space-separated identifiers in one
  body (`LRL 0171... 0172...`), not just one.
- In test mode, `to` is `testDestination` instead of the operator shortcode.
- If a job is claimed but never acked within 90 seconds, a maintenance sweep
  resets it back to `PENDING_PICKUP` so it gets retried on the next poll
  (`store.reclaimStaleClaimedJobs`, see [`src/maintenance.js`](../src/maintenance.js)).

### 2. Ack the result (phone → PC)

```http
POST http://<PC_LAN_IP>:3000/api/gateway/jobs/outbox_8mrrs9xw/ack
Content-Type: application/json
x-gateway-secret: <per-gateway secret>

{ "gatewayId": "GP_PHONE_01", "ok": true, "providerMessageId": "sms_1781126748295" }
```

Failure case: `{ "gatewayId": "GP_PHONE_01", "ok": false, "error": "description" }`.

Response: `{ "ok": true, "sentStatus": "SENT" }` (or `"FAILED"`).

The backend stamps `sendResult.confirmedAt` on ack — this is what starts the
operator reply-window clock (not the original queue time), so a delayed
phone doesn't lose reply-window time it never got to use. There's also a
**send-confirmation grace period** before that: a job that's been claimed but
not yet acked has its own shorter timeout window so a phone that claimed a
job and then went silent doesn't leave the request hanging forever either.

**Known gap:** the phone reports `ok: true` once `SmsManager` accepts the
send, which is not carrier-confirmed — a dual-SIM wrong-slot or no-signal
failure can surface seconds later in the system SMS app, after the ack
already said success. Target: sent-intent callbacks.

---

## Phone → Backend: Incoming SMS Webhook

```http
POST http://<PC_LAN_IP>:3000/api/sms/inbound
Content-Type: application/json

{
  "gatewayId": "GP_PHONE_01",
  "from": "+8801936759367",
  "body": "MSISDN: 8801724761972\nLastActiveDateTime: ...",
  "receivedAt": "2026-06-11T03:27:35+06:00"
}
```

Backend ignores messages unless `from` (normalized) is in that gateway's `trustedSenders` list in `config/gateways.json`.

Matching: trusted sender + single pending request on gateway within reply window → `NEEDS_MANUAL_REVIEW` + reply draft.

---

## Phone App Requirements

- Send SMS from the phone's **active/default SMS SIM** (dual-SIM: user must pick correct SIM in phone settings until app adds SIM picker)
- Read incoming SMS (`RECEIVE_SMS`, `READ_SMS`)
- Foreground service so Android does not kill the HTTP server
- Retry inbound webhooks via WorkManager when backend unreachable
- Local Room log of sent/received/forwarded messages
- Never alter the operator SMS command body
- Register gateway URL with backend on service start
- Optional: auto-discover backend URL on LAN (v1.2.1)

---

## Trusted Senders (`config/gateways.json`)

Per-operator array. Include:

- Operator shortcodes (e.g. `12345`)
- Test reply phone numbers in `01xxxxxxxxx` form (e.g. `01936759367`)
- Any alphanumeric sender IDs operators use for replies

Example (GP, home test session):

```json
"trustedSenders": ["12345", "01700000001", "01800000002", "01320151105", "01936759367"]
```

Restart backend after editing `gateways.json`.

---

## Test Mode Flow (validated)

1. App `POST /api/requests` with `testDestination: "01936759367"`
2. Backend queues a `PENDING_PICKUP` outbox job → phone polls
   `GET /api/gateway/jobs`, claims it, and sends `to: 01936759367`
3. Target phone receives `LRL <payload>`, replies manually
4. Phone `SmsReceiver` → `POST /api/sms/inbound`
5. Backend drafts reply → dashboard `NEEDS_MANUAL_REVIEW`
6. Reviewer approves draft → Telegram bridge posts to group
