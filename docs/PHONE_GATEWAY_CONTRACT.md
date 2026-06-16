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

Backend updates `gatewayUrl` **in memory**. Restart backend → phone must Start Service again (or set `gatewayUrl` manually in `config/gateways.json`).

`config/gateways.json` may use `"gatewayUrl": ""` for GP to rely on auto-registration.

---

## Backend → Phone: Send SMS

```http
POST http://<PHONE_IP>:8080/send-sms
Content-Type: application/json

{
  "to": "01936759367",
  "message": "LRL 01724761972",
  "requestId": "REQ-20260610-0002-P94E",
  "operator": "GP"
}
```

- `message` must be sent **exactly** to the operator/test destination. No backend metadata appended.
- In test mode, `to` is `testDestination` instead of operator shortcode `12345`.

Expected response (phone HTTP layer — **not carrier-confirmed**):

```json
{
  "ok": true,
  "providerMessageId": "sms_1781126748295"
}
```

Error response:

```json
{
  "ok": false,
  "error": "description"
}
```

**Known gap:** phone returns `ok: true` when `SmsManager` accepts the send. Carrier failure (e.g. dual-SIM wrong slot, no signal) may occur seconds later in the system SMS app. Target: sent-intent callbacks.

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
2. Backend queues → `POST` phone `/send-sms` with `to: 01936759367`
3. Target phone receives `LRL <payload>`, replies manually
4. Phone `SmsReceiver` → `POST /api/sms/inbound`
5. Backend drafts reply → dashboard `NEEDS_MANUAL_REVIEW`
6. Reviewer approves draft → Telegram bridge posts to group
