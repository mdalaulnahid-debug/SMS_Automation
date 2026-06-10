@echo off
setlocal
set ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
if not exist "%ADB%" set ADB=C:\BuildTools\android-sdk\platform-tools\adb.exe

echo.
echo SMS Gateway crash log capture
echo ===========================
echo.

"%ADB%" devices
echo.

for /f "tokens=2" %%i in ('"%ADB%" devices ^| findstr /r "device$"') do set DEVICE=%%i
if "%DEVICE%"=="" (
    echo No phone connected.
    echo.
    echo 1. Enable USB debugging on the phone
    echo 2. Connect USB cable
    echo 3. Accept the debugging prompt on the phone
    echo 4. Run this script again
    echo.
    pause
    exit /b 1
)

echo Connected: %DEVICE%
echo.
echo Reproduce the crash now: open the app and tap Start Service.
echo Logging for 30 seconds...
echo.

"%ADB%" logcat -c
timeout /t 30 /nobreak >nul
"%ADB%" logcat -d -s GatewayService AndroidRuntime ActivityManager System.err > crash-log.txt

echo.
echo Saved: %cd%\crash-log.txt
echo.
type crash-log.txt
echo.
pause
