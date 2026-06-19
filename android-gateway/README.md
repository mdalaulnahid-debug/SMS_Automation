# Android SMS Gateway App

Kotlin companion app that turns an Android phone into an operator SMS gateway for the SMS Automation backend.

**Current release:** v2.6.1 (`versionCode` 47)  
**APK:** `app/build/outputs/apk/release/app-release.apk`

See `../progress_tracker.md` for the latest backend and Android handoff context.

---

## What It Does

| Direction | Mechanism |
|-----------|-----------|
| Backend -> Phone | `POST /send-sms` on port 8080 (NanoHTTPD) |
| Phone -> Network | `SmsManager` sends SMS from the phone SIM |
| Network -> Phone | `SmsReceiver` catches inbound SMS |
| Phone -> Backend | OkHttp `POST /api/sms/inbound` webhook |
| Phone -> Backend (discovery) | Scans LAN for `GET /api/health` when backend URL is blank |
| Phone -> Backend (register) | `POST /api/gateways/register` on Start Service |
| Phone -> Backend (retry) | WorkManager resubmits failed inbound webhooks with dedupe-safe metadata |

---

## Screens

- **Permissions** -> SMS + notification permissions
- **Home** -> service status, backend health, test request panel, recent activity
- **Settings** -> gateway ID, backend URL, HTTP port, test Telegram metadata
- **Activity Log** -> Room-backed sent/received/forwarded history
- **Retry safety** -> original inbound reply identity is preserved across delayed resends

---

## Per-Phone Setup

Install the same APK on each gateway phone. Only difference is Settings:

| Phone | Gateway ID |
|-------|------------|
| GP SIM | `GP_PHONE_01` |
| Robi SIM | `ROBI_PHONE_01` |
| Banglalink SIM | `BANGLALINK_PHONE_01` |

### Settings fields

| Field | Typical value | Notes |
|-------|---------------|-------|
| Gateway ID | `GP_PHONE_01` | Must match backend config key |
| Backend URL | `http://45.77.240.195:3000` or local LAN backend | Blank also works for LAN auto-discovery |
| HTTP port | `8080` | Must match phone-side listener |
| Telegram Chat ID | `test-chat-id` | Stored on request; used by Telegram bridge to post reply |
| Requester Telegram ID | `test-requester` | Auth metadata |
| Requester Name | `Test User` | Appears as `@Test User` in draft |

### Dual-SIM phones

If the phone has two SIMs, Android uses the default SMS SIM. Wrong SIM can still produce `resultCode: 4` / no-service behavior in the system SMS app.

Current limitation:

- `SmsSender.kt` still uses the active/default SMS SIM
- the correct SIM must still be selected in Android phone settings

---

## Build

### Quick build

```bat
cd android-gateway
build-apk.bat
```

Output:

```text
app/build/outputs/apk/release/app-release.apk
```

### Manual Gradle

```bat
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
gradlew.bat :app:assembleDebug
gradlew.bat :app:assembleRelease
```

### Requirements

| Tool | Version / path |
|------|----------------|
| JDK | 17 (`C:\Program Files\Android\Android Studio\jbr`) |
| Android SDK | API 34 |
| Gradle wrapper | bundled with repo |
| Keystore | optional for local compile; release signing uses `keystore.properties` when present |

Verified in this session:

- `:app:assembleDebug` builds successfully with Android Studio JBR

---

## Version History (recent)

| Version | Changes |
|---------|---------|
| **2.6.1** | Inbound webhook retry preserves original gateway/body/time, adds a deterministic delivery key, and prevents duplicate backend processing after temporary internet loss |
| **2.x** | Admin and gateway improvements across polling, registration, OTA, and dual-SIM support |
| **1.2.1** | Backend discovery fix: priority scan 200-254, 1s connect timeout, validates health JSON |
| **1.2.0** | Auto-discovery, blank default backend URL, gateway register on Start Service |

---

## Inbound Retry Behavior

If internet is down when an operator reply arrives:

1. `SmsReceiver` stores the inbound event in Room
2. `WebhookSender` tries immediate delivery
3. `RetryWorker` resubmits later when connectivity returns
4. the retry preserves:
   - original `gatewayId`
   - full message body
   - original receive timestamp text
   - deterministic `deliveryKey`
5. backend deduplicates repeated deliveries of the same SMS event

This means temporary internet loss should no longer cause either lost reply submission or duplicate reply processing.

---

## Test Request Flow

1. Enter request type, payload, and target number in the app
2. App calls backend `POST /api/requests` with `testDestination`
3. Backend queues the SMS job
4. Phone sends the SMS through the SIM
5. Reply comes back by SMS
6. Phone forwards `POST /api/sms/inbound`
7. Backend matches the reply if the sender is trusted

Note:

- app/backend may show sent once Android accepts the SMS job, not when the carrier confirms delivery

---

## Key Source Files

```text
com/smsgateway/
|- BackendDiscovery.kt
|- BackendClient.kt
|- GatewayForegroundService.kt
|- HttpServer.kt
|- SmsSender.kt
|- SmsReceiver.kt
|- WebhookSender.kt
|- RetryWorker.kt
|- MainActivity.kt
|- SettingsActivity.kt
|- LogActivity.kt
|- Prefs.kt
|- NetworkUtils.kt
`- db/
```

---

## HTTP API (Phone Side)

### `POST /send-sms`

```json
{
  "to": "01936759367",
  "message": "LRL 01724761972",
  "requestId": "REQ-20260610-0002-P94E",
  "operator": "GP"
}
```

Response is immediate and not carrier-confirmed:

```json
{ "ok": true, "providerMessageId": "sms_1781126748295" }
```

Full contract: `../docs/PHONE_GATEWAY_CONTRACT.md`

---

## Debug

See `ANDROID_STUDIO_DEBUG.md` for Android Studio setup and Logcat filters.

```bat
adb logcat -s BackendDiscovery,BackendClient,HttpServer,SmsSender,SmsReceiver,WebhookSender,GatewayForegroundService
```
