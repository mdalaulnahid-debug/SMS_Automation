# publish-apk.ps1 — build the Android APK and publish it to the backend for OTA delivery.
# Run from the repo root: .\scripts\publish-apk.ps1
# Optional: .\scripts\publish-apk.ps1 -ReleaseNotes "Fixed X, added Y"

param(
    [string]$ReleaseNotes = ""
)

$env:JAVA_HOME   = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "C:\Users\Dell\AppData\Local\Android\Sdk"

$apkSrc  = "android-gateway\app\build\outputs\apk\debug\app-debug.apk"
$apkDst  = "public\gateway-app.apk"
$verFile = "public\app-version.json"
$gradle  = "android-gateway\gradlew.bat"

Write-Host "==> Building APK..." -ForegroundColor Cyan
Push-Location android-gateway
& .\gradlew assembleDebug
$exitCode = $LASTEXITCODE
Pop-Location

if ($exitCode -ne 0) {
    Write-Host "Build FAILED (exit $exitCode)" -ForegroundColor Red
    exit 1
}

# Read version from build.gradle.kts
$gradleKts = Get-Content "android-gateway\app\build.gradle.kts" -Raw
$versionCode = [int]($gradleKts | Select-String 'versionCode\s*=\s*(\d+)' | ForEach-Object { $_.Matches[0].Groups[1].Value })
$versionName = ($gradleKts | Select-String 'versionName\s*=\s*"([^"]+)"' | ForEach-Object { $_.Matches[0].Groups[1].Value })

Write-Host "==> Copying APK v$versionName (code $versionCode) -> $apkDst" -ForegroundColor Cyan
Copy-Item -Path $apkSrc -Destination $apkDst -Force

$notes = if ($ReleaseNotes) { $ReleaseNotes } else { "v$versionName" }
$json = [PSCustomObject]@{
    versionCode  = $versionCode
    versionName  = $versionName
    releaseNotes = $notes
} | ConvertTo-Json
$json | Out-File -FilePath $verFile -Encoding utf8

Write-Host "==> Published: $verFile" -ForegroundColor Green
Write-Host ($json)
Write-Host ""
Write-Host "Phones will pick up the update within a few minutes." -ForegroundColor Green
