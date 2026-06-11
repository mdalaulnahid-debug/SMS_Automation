@echo off
title Telegram Bridge
cd /d "%~dp0.."
:loop
node telegram-bridge/start.js
echo.
echo [bridge stopped - restarting in 5s...]
timeout /t 5 /nobreak >nul
goto loop
