@echo off
setlocal EnableExtensions
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-workstation.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Workstation bootstrap failed with code %EXIT_CODE%.
  echo.
  pause
)

exit /b %EXIT_CODE%
