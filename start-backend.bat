@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title SMS Automation Backend

echo.
echo  SMS Automation Backend
echo  ======================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not in PATH.
  echo Install Node.js 18+ from https://nodejs.org
  echo.
  pause
  exit /b 1
)

set "LAN_IP="
for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\get-lan-ip.ps1" 2^>nul') do set "LAN_IP=%%i"
if not defined LAN_IP set "LAN_IP=YOUR_PC_IP"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-firewall-3000.ps1" >nul 2>&1

if not exist "node_modules\" (
  echo Installing npm dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo ERROR: npm install failed.
    echo.
    pause
    exit /b 1
  )
)

if not exist "config\gateways.json" (
  echo Creating config\gateways.json from example...
  copy /Y "config\gateways.example.json" "config\gateways.json" >nul
  echo.
  echo  ACTION REQUIRED before testing:
  echo  1. Edit config\gateways.json
  echo  2. Set GP gatewayUrl to your phone IP, e.g. http://192.168.0.172:8080
  echo  3. Add your test reply phone numbers to trustedSenders
  echo.
)

set "HOST=0.0.0.0"
set "PORT=3000"

for /f "delims=" %%p in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\is-port-listening.ps1" -Port %PORT% 2^>nul') do set "BUSY_PID=%%p"

if defined BUSY_PID (
  echo  Port %PORT% is in use by PID %BUSY_PID%.
  echo  Stopping old backend first...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-backend-port.ps1" -Port %PORT%
  timeout /t 2 /nobreak >nul
)

echo  Dashboard (PC):     http://localhost:%PORT%
echo  Backend (phone app): http://%LAN_IP%:%PORT%
echo.
echo  IMPORTANT: Use the Wi-Fi IP above in the phone app Settings.
echo  Do NOT use VPN IPs (NordVPN/Tailscale).
echo.
echo  Testing checklist:
echo  - Phone and PC on same Wi-Fi
echo  - Gateway app service RUNNING
echo  - trustedSenders includes the number that will reply manually
echo.
echo  Press Ctrl+C to stop the server.
echo.

call npm start
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo ERROR: Server exited with code %EXIT_CODE%.
  echo  - Port %PORT% may still be in use: run stop-backend.bat
  echo  - Or run this file again (it auto-stops the old server)
  echo.
) else (
  echo Server stopped.
  echo.
)
pause
exit /b %EXIT_CODE%
