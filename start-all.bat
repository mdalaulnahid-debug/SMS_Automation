@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title SMS Automation — Full Stack

echo.
echo  SMS Automation — Backend + Telegram Bridge
echo  ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not in PATH.
  echo Install Node.js 18+ from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "config\telegram.json" (
  echo  config\telegram.json not found.
  echo.
  echo  Run setup-telegram.bat first, or copy the example manually:
  echo    copy config\telegram.example.json config\telegram.json
  echo    ^(then edit it with your bot token, group ID and authorized users^)
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing npm dependencies...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
)

if not exist "config\gateways.json" (
  echo Creating config\gateways.json from example...
  copy /Y "config\gateways.example.json" "config\gateways.json" >nul
)

set "LAN_IP="
for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\get-lan-ip.ps1" 2^>nul') do set "LAN_IP=%%i"
if not defined LAN_IP set "LAN_IP=YOUR_PC_IP"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-firewall-3000.ps1" >nul 2>&1

echo  Backend URL (phone):     http://%LAN_IP%:3000
echo  Dashboard (browser):     http://localhost:3000
echo.
echo  Both backend and Telegram bridge will start in separate windows.
echo  Close this window or press Ctrl+C to stop everything.
echo.

:: Start backend in a new window (auto-restarts on crash)
start "SMS Backend" cmd /k "title SMS Backend && :loop && node src/server.js && timeout /t 3 /nobreak >nul && goto loop"

:: Wait for backend to be ready before starting the bridge
echo  Waiting for backend to start...
timeout /t 4 /nobreak >nul

:: Start Telegram bridge in a new window (auto-restarts on crash)
start "Telegram Bridge" cmd /k "title Telegram Bridge && :loop && node telegram-bridge/start.js && echo [bridge crashed - restarting in 5s] && timeout /t 5 /nobreak >nul && goto loop"

echo  Both processes started in separate windows.
echo  Watch those windows for logs.
echo.
echo  To stop: close the Backend and Telegram Bridge windows.
echo.
pause
