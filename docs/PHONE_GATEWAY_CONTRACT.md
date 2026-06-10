# Android Phone SMS Gateway Contract

Each Android phone should expose one local HTTP endpoint for sending SMS and should forward incoming SMS to the backend webhook.

## Phone Roles

- GP phone: GP SIM only, configured as `GP_PHONE_01`.
- Robi phone: Robi SIM only, configured as `ROBI_PHONE_01`.
- Banglalink phone: Banglalink SIM only, configured as `BANGLALINK_PHONE_01`.

## Backend To Phone: Send SMS

The backend sends an HTTP request to each phone gateway:

```http
POST /send-sms
Content-Type: application/json

{
  "to": "12345",
  "message": "LRL 01712345678",
  "requestId": "REQ-20260610-0001",
  "operator": "GP"
}
```

The `message` field must be sent exactly to the operator service. Do not append backend references or other metadata to the SMS body.

Expected response:

```json
{
  "ok": true,
  "providerMessageId": "optional-phone-local-id"
}
```

## Phone To Backend: Incoming SMS Webhook

Each phone forwards incoming SMS to:

```http
POST http://BACKEND_HOST:3000/api/sms/inbound
Content-Type: application/json

{
  "gatewayId": "GP_PHONE_01",
  "from": "12345",
  "body": "LRL cell location response text",
  "receivedAt": "2026-06-10T13:35:00+06:00"
}
```

The backend ignores messages unless `from` is configured as a trusted push-pull, hotline, or network sender for that gateway.

## Phone App Requirements

- Send SMS from the phone's active SIM.
- Read incoming SMS using Android SMS receive permissions.
- Run as a foreground service so Android does not stop it silently.
- Retry delivery of inbound webhooks when Wi-Fi/backend is temporarily down.
- Keep a local log of the last sent SMS and last forwarded SMS.
- Never alter the operator SMS command body.
