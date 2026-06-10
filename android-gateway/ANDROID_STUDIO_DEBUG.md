# Debug Start Service crash in Android Studio

**App version:** v1.2.1 (Start Service stable since v1.1.4).  
**Session notes:** see `../progress_tracker.md` for dual-SIM SMS failure (`resultCode: 4`) and E2E test results.

---

## 1. Install missing SDK (required once)

Your Android Studio SDK currently has **API 36.1 only**. This project needs **API 34**.

In Android Studio:

1. **File → Settings → Languages & Frameworks → Android SDK**
2. **SDK Platforms** tab → check **Android 14.0 (API 34)** → Apply
3. **SDK Tools** tab → check **Android SDK Build-Tools 34** → Apply

Wait for download to finish.

## 2. Open the project

1. **File → Open** → select folder:
   ```
   SMS_Automation/android-gateway
   ```
2. Let Gradle sync finish (use Android Studio's **Run** / **Build**, not command-line Gradle, if sync fails due to SSL/antivirus).

## 3. Connect the phone

1. On phone: **Settings → Developer options → USB debugging** ON
2. Connect USB cable
3. Accept **Allow USB debugging** prompt on phone
4. In Android Studio top bar, your phone should appear in the device dropdown

Verify in terminal:

```bat
%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe devices
```

Should show one device (not empty).

## 4. Install and run from Android Studio

1. Select your phone in the device dropdown
2. Click **Run** (green play button)
3. App installs and opens on the phone

Or install the prebuilt APK:

```bat
%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe install -r app\build\outputs\apk\debug\app-debug.apk
```

## 5. Capture the crash in Logcat

1. Android Studio bottom panel → **Logcat**
2. Device: your phone
3. Filter: `package:com.smsgateway`
4. Level: **Error**
5. On phone: tap **Start Service**
6. Look for red lines:

```
AndroidRuntime: FATAL EXCEPTION
GatewayService: Foreground promotion failed
```

Copy the full stack trace (10–20 lines after `FATAL EXCEPTION`).

### Alternative: batch script

From repo folder:

```bat
android-gateway\capture-crash-log.bat
```

Reproduce crash within 30 seconds. Output saved to `crash-log.txt`.

## 6. App settings (for your backend)

| Setting | Value |
|---------|-------|
| Gateway ID | `GP_PHONE_01` (GP SIM phone) |
| Backend URL | `http://10.5.0.2:3000` |
| HTTP Port | `8080` |
| API Key | leave blank |

Grant **SMS** + **Notifications** before Start Service.

## 7. SMS "Message sent failed" (dual-SIM)

If Samsung Messages shows **Not sent** / **Message sent failed** but the gateway app logged send OK:

1. **Settings → SIM manager** → set **SMS** to the working operator SIM
2. Check signal bars (not Wi‑Fi only)
3. Logcat: `adb logcat -s SmsSender,Bugle` — look for `resultCode: 4` (No service)
4. Our app does not pick SIM slot yet — uses Android default SMS subscription

## 8. Backend not found

- Phone and PC must be on same Wi‑Fi
- v1.2.1+ auto-discovers backend; or set Backend URL manually in Settings
- Logcat: `adb logcat -s BackendDiscovery,BackendClient`
- PC: run `start-backend.bat`, note printed LAN IP

## 9. Build release APK from command line

```bat
cd android-gateway
build-apk.bat
```

APK: `app/build/outputs/apk/release/app-release.apk`

## Known fixes already in v1.1.4

- Wrong foreground service type (`connectedDevice` → `dataSync` / `remoteMessaging`)
- Invalid notification action icon on Android 14
- Missing `startForeground()` on duplicate start commands (main repeat-crash cause)
- Start button debounce

If crash persists after v1.1.4 + SDK 34 installed, the Logcat stack trace is required to find the next issue.
