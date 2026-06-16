# Android SMS Gateway App

Kotlin companion app that turns an Android phone into an operator SMS gateway for the SMS Automation backend.

**Current release:** v1.2.1 (`versionCode` 8)  
**APK:** `app/build/outputs/apk/release/app-release.apk`

See `../progress_tracker.md` for 2026-06-11 test results, dual-SIM issue, and office handoff.

---

## What It Does

| Direction | Mechanism |
|-----------|-----------|
| Backend → Phone | `POST /send-sms` on port 8080 (NanoHTTPD) |
| Phone → Network | `SmsManager` sends SMS from the phone SIM |
| Network → Phone | `SmsReceiver` catches inbound SMS |
| Phone → Backend | OkHttp `POST /api/sms/inbound` webhook |
| Phone → Backend (discovery) | Scans LAN for `GET /api/health` (v1.2.1) |
| Phone → Backend (register) | `POST /api/gateways/register` on Start Service |

---

## Screens

- **Permissions** — SMS + notification permissions
- **Home** — service status, backend health, test request panel, recent activity
- **Settings** — gateway ID, backend URL, HTTP port, test Telegram metadata
- **Activity Log** — Room-backed sent/received/forwarded history

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
| Backend URL | *(blank)* or `http://<PC_IP>:3000` | Blank = auto-discovery (v1.2.1+) |
| HTTP port | `8080` | Must match `gateways.json` / registration |
| Telegram Chat ID | `test-chat-id` | Stored on request; used by Telegram bridge to post reply |
| Requester Telegram ID | `test-requester` | Auth metadata |
| Requester Name | `Test User` | Appears as `@Test User` in draft |

### Dual-SIM phones (important)

If the phone has two SIMs, Android uses the **default SMS SIM**. Wrong SIM → `resultCode: 4` (No service) → "Message sent failed" in Samsung Messages.

**Workaround:** Phone Settings → SIM manager → set **SMS** to the working operator SIM.

**App gap (TODO):** no SIM slot picker yet — `SmsSender.kt` uses `SmsManager.getDefault()`.

Tested device: Samsung Galaxy A55 — slot 0 (subId 2) working GP, slot 1 (subId 1) "Emergency only". See `../progress_tracker.md`.

---

## Build

### Quick build (Windows)

```bat
cd android-gateway
build-apk.bat
```

Output: `app/build/outputs/apk/release/app-release.apk`

### Manual Gradle

```bat
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
set GRADLE=C:\BuildTools\gradle\gradle-8.6\bin\gradle.bat
echo sdk.dir=C:\\BuildTools\\android-sdk> local.properties
"%GRADLE%" assembleRelease --no-daemon
```

### Requirements

| Tool | Version / path (home PC) |
|------|--------------------------|
| JDK | 17 (Android Studio JBR) |
| Gradle | 8.6 (`C:\BuildTools\gradle\gradle-8.6`) |
| Android SDK | API 34 (`C:\BuildTools\android-sdk`) |
| Keystore | `C:\BuildTools\smsgateway.keystore` (configured in `app/build.gradle.kts`) |

Android Studio SDK may only have API 36 — CLI build needs API 34 in BuildTools SDK or install API 34 in Studio (see `ANDROID_STUDIO_DEBUG.md`).

### Install via adb

```bat
%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe install -r app\build\outputs\apk\release\app-release.apk
```

---

## Version History (recent)

| Version | Changes |
|---------|---------|
| **1.2.1** | Backend discovery fix: priority scan 200–254, 1s connect timeout, validates health JSON |
| **1.2.0** | Auto-discovery, blank default backend URL, gateway register on Start Service |
| **1.1.4** | Start Service: always `startForeground()`, debounce, `ServiceEvents` broadcasts |
| **1.1.3** | `dataSync` foreground type, notification permission guard |
| **1.1.1** | Dark UI, test request panel, backend health, copy IP |

---

## Start Service (v1.1.4+)

**Fixes applied:**
1. `foregroundServiceType` → `dataSync` + `remoteMessaging`
2. Removed invalid `addAction(0, …)` in notification
3. Every `startForegroundService()` call promotes to foreground immediately
4. Notification permission checked (Android 13+)
5. HTTP server starts off main thread; errors broadcast via `ServiceEvents`

**If service fails:**
- Grant **Notifications** permission
- Change HTTP port if 8080 in use
- Disable battery optimization for the app
- Logcat: `adb logcat -s GatewayForegroundService,HttpServer,SmsSender,AndroidRuntime`

---

## Backend Auto-Discovery (v1.2.1)

On app resume, if saved Backend URL fails or is blank:

1. Read phone Wi‑Fi IP → derive subnet (e.g. `192.168.0`)
2. Try last-known URL first
3. Scan hosts in priority order: `.1`, `.254`, `.200–.254`, then rest
4. Fast health check (1s connect) — must return `service: sms-whatsapp-automation`
5. Save discovered URL to prefs

**v1.2.0 bug:** scanned 1→254 with 8s timeout / 10s total — missed PCs in high DHCP range (e.g. `.230`).

---

## Gateway Registration

When **Start Service** succeeds, if backend URL and local IP are known:

```http
POST http://<PC_IP>:3000/api/gateways/register
{ "gatewayId": "GP_PHONE_01", "host": "192.168.0.172", "port": 8080 }
```

Backend updates `gatewayUrl` in memory → PC can send SMS to phone.

---

## Test Request Flow

Main screen **Test Request** card:

1. Enter request type, payload, **target number** (receives SMS + replies manually)
2. App calls backend `POST /api/requests` with `testDestination`
3. Backend → phone `POST /send-sms` → SIM sends SMS
4. Manual reply from target → `SmsReceiver` → `POST /api/sms/inbound`
5. Backend matches if sender in `trustedSenders`

**Note:** App/backend may show SENT before carrier confirms. Check Samsung Messages for delivery failure.

---

## Key Source Files

```text
com/smsgateway/
├── BackendDiscovery.kt         # LAN scan for backend (v1.2.1)
├── BackendClient.kt            # Health, discovery, register, test request
├── GatewayForegroundService.kt # Foreground service + HTTP server
├── HttpServer.kt               # POST /send-sms handler
├── SmsSender.kt                # SmsManager wrapper (no SIM picker yet)
├── SmsReceiver.kt              # Inbound SMS broadcast receiver
├── WebhookSender.kt            # Forward to backend /api/sms/inbound
├── RetryWorker.kt              # WorkManager retry for failed webhooks
├── MainActivity.kt               # Main UI + test request + discovery
├── SettingsActivity.kt
├── LogActivity.kt
├── Prefs.kt                    # SharedPreferences
├── NetworkUtils.kt             # Local IP + subnet prefix
└── db/                         # Room database for logs
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

Response (immediate — not carrier-confirmed):

```json
{ "ok": true, "providerMessageId": "sms_1781126748295" }
```

Full contract: `../docs/PHONE_GATEWAY_CONTRACT.md`

---

## Debug

See `ANDROID_STUDIO_DEBUG.md` for Android Studio setup, Logcat filters, and SDK API 34 install.

```bat
adb logcat -s BackendDiscovery,BackendClient,HttpServer,SmsSender,SmsReceiver,WebhookSender,GatewayForegroundService
```
