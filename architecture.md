# Architecture

## Purpose

This system automates controlled operator push-pull SMS workflows. Authorized users submit formatted requests, the backend routes each request to the correct operator gateway phone, operator replies are filtered and matched, and a WhatsApp-ready reply draft is prepared for manual review.

## Core Flow

```text
WhatsApp/manual request
-> backend parser
-> operator router
-> per-operator queue
-> Android SMS gateway phone
-> operator push-pull service
-> inbound SMS webhook
-> trusted sender filter
-> reply matcher/analyzer
-> manual review
-> WhatsApp-ready tagged reply
```

## Request Types

- `LRL`: last radio location. Sent only to the relevant operator by MSISDN prefix.
- `LCL`: last call location. Sent only to the relevant operator by MSISDN prefix.
- `MS-NID`: mobile number to NID. Sent to GP, Robi, and Banglalink.
- `NID-MS`: NID to mobile number. Sent to GP, Robi, and Banglalink.
- `IMEI-MS`: IMEI to mobile number. Sent to GP, Robi, and Banglalink.

## SMS Gateway Integration

Each operator has one Android phone:

- `GP_PHONE_01`
- `ROBI_PHONE_01`
- `BANGLALINK_PHONE_01`

The backend sends HTTP requests to each phone gateway. The phone sends the SMS using its SIM and forwards incoming SMS replies to `/api/sms/inbound`.

Operator SMS must remain hardbound: the backend sends only `REQUEST_TYPE VALUE`. Silent references are backend-only.

## Reply Matching

The backend only analyzes inbound SMS from trusted push-pull, hotline, or network sender IDs. Matching uses:

- gateway phone
- trusted sender
- active pending request for that gateway
- request time window
- request type and operator reply pattern
- manual review before completion

## Training Data

Excel files under `Training Data/Automation` are imported into `data/reply-patterns.json`. The analyzer uses those examples together with built-in fallback rules.
