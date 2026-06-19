# Android Phone SMS Gateway Contract

Each Android phone acts as an operator SMS gateway for the backend. The backend queues outbound jobs, the phone polls and claims them, then the phone forwards inbound operator replies back to the backend.

---

## Phone Roles

| Device | Gateway ID | SIM |
|--------|------------|-----|
| GP phone | `GP_PHONE_01` | Grameenphone |
| Robi phone | `ROBI_PHONE_01` | Robi |
| Banglalink phone | `BANGLALINK_PHONE_01` | Banglalink |

One APK serves all phones; identity is selected in Settings.

---

## Discovery And Registration

### Backend health

```http
GET http://<PC_OR_VPS>:3000/api/health
```

Example response:

```json
{
  "ok": true,
  "service": "sms-telegram-automation",
  "version": "0.1.0",
  "port": 3000
}
```

### Gateway registration

When the foreground service starts, the phone registers its identity and listener details:

```http
POST http://<PC_OR_VPS>:3000/api/gateways/register
Content-Type: application/json
x-gateway-secret: <per-gateway secret>

{
  "gatewayId": "GP_PHONE_01",
  "host": "192.168.0.172",
  "localIp": "192.168.0.172",
  "port": 8080
}
```

### Heartbeat

```http
POST http://<PC_OR_VPS>:3000/api/gateway/heartbeat
Content-Type: application/json
x-gateway-secret: <per-gateway secret>

{ "gatewayId": "GP_PHONE_01" }
```

Heartbeat keeps gateway `lastSeenAt` fresh even when there are no pending jobs.

---

## Backend -> Phone: SMS Dispatch

The active design is poll-based. The backend does not push SMS requests directly to the phone.

### 1. Poll and claim jobs

```http
GET http://<PC_OR_VPS>:3000/api/gateway/jobs?gatewayId=GP_PHONE_01
x-gateway-secret: <per-gateway secret>
```

Response:

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

Rules:

- `message` is the canonical operator SMS body built by `src/parser.js`
- operator-facing command format remains hardbound
- intake may be lightly normalized first, but the dispatched SMS must already be in canonical telecom format
- up to 5 identifiers may appear in one operator SMS body
- in test mode, `to` is `testDestination` instead of the operator shortcode

### 2. Ack send result

```http
POST http://<PC_OR_VPS>:3000/api/gateway/jobs/outbox_8mrrs9xw/ack
Content-Type: application/json
x-gateway-secret: <per-gateway secret>

{ "gatewayId": "GP_PHONE_01", "ok": true, "providerMessageId": "sms_1781126748295" }
```

Failure example:

```json
{ "gatewayId": "GP_PHONE_01", "ok": false, "error": "description" }
```

Notes:

- backend starts the operator reply window from send confirmation time, not original queue time
- stale claimed jobs are reclaimed if the phone goes silent before ack
- `ok: true` means Android accepted the SMS job, not that the carrier confirmed delivery

---

## Phone -> Backend: Incoming SMS Webhook

```http
POST http://<PC_OR_VPS>:3000/api/sms/inbound
Content-Type: application/json
x-gateway-secret: <per-gateway secret>

{
  "gatewayId": "GP_PHONE_01",
  "from": "+8801936759367",
  "body": "MSISDN: 8801724761972\nLastActiveDateTime: ...",
  "receivedAt": "2026-06-11T03:27:35+06:00",
  "deliveryKey": "GP_PHONE_01:01936759367:2026-06-11T03:27:35+06:00:<body-hash>"
}
```

Rules:

- backend ignores inbound SMS unless normalized `from` is in that gateway's `trustedSenders`
- backend correlates replies using payload anchors, request-family checks, curated training-cache scoring, and manual-review fallback
- one ambiguous reply should fall to review instead of being forced onto the wrong request

### Retry behavior

If internet is temporarily down when the phone receives the operator SMS:

1. Android stores the inbound event locally in Room
2. it attempts immediate webhook delivery
3. WorkManager retries later when network returns
4. retry preserves:
   - original `gatewayId`
   - original full `body`
   - original receive timestamp
   - deterministic `deliveryKey`
5. backend deduplicates repeated deliveries of that same SMS event

This protects both sides:

- replies are not lost just because the network was briefly unavailable
- delayed retries do not create duplicate inbox rows or duplicate Telegram postings

---

## Phone App Requirements

- Send SMS from the active/default SMS SIM
- Read incoming SMS (`RECEIVE_SMS`, `READ_SMS`)
- Run a foreground service so Android does not kill the gateway loop
- Retry failed inbound webhooks via WorkManager
- Preserve original inbound SMS identity across retries
- Keep a Room log of sent/received/forwarded messages
- Never alter the canonical operator SMS command body
- Register gateway identity on service start

---

## Trusted Senders

Configured in `config/gateways.json` per operator. Include:

- operator shortcodes such as `12345`
- known reply numbers in normalized `01...` form
- alphanumeric sender IDs used by operators

Example:

```json
"trustedSenders": ["12345", "01700000001", "01800000002", "01320151105", "01936759367"]
```

---

## Test Mode

1. App submits `POST /api/requests` with `testDestination`
2. Backend queues a gateway job
3. Phone polls and sends the SMS to the test phone
4. Test phone replies manually
5. Gateway forwards inbound SMS
6. Backend creates a reviewable reply draft
