@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "GRADLE=C:\BuildTools\gradle\gradle-8.6\bin\gradle.bat"
set "SDK_DIR=C:\BuildTools\android-sdk"

if not exist "%JAVA_HOME%" (
  set "JAVA_HOME=C:\BuildTools\jdk17-raw\jdk-17.0.19+10"
)

if not exist "%GRADLE%" (
  echo ERROR: Gradle not found at %GRADLE%
  echo Use Android Studio: Build ^> Build APK^(s^)
  pause
  exit /b 1
)

echo sdk.dir=%SDK_DIR:\=\\%> local.properties

echo Building release APK...
echo First build may download Gradle plugins — needs internet.
echo.

call "%GRADLE%" assembleRelease --no-daemon
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo APK ready:
  echo %cd%\app\build\outputs\apk\release\app-release.apk
) else (
  echo Build failed.
  echo If you see SSL/certificate errors, use Android Studio instead:
  echo   File ^> Open ^> android-gateway
  echo   Build ^> Build APK^(s^)
)
echo.
pause
exit /b %EXIT_CODE%
