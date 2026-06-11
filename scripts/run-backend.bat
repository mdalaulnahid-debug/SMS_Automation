@echo off
title SMS Backend
cd /d "%~dp0.."
:loop
node src/server.js
echo.
echo [backend stopped - restarting in 3s...]
timeout /t 3 /nobreak >nul
goto loop
