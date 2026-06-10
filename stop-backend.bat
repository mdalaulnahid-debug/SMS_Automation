@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Stop SMS Automation Backend

set "PORT=3000"
if not "%~1"=="" set "PORT=%~1"

echo.
echo  Stop SMS Automation Backend
echo  ===========================
echo.
echo  Looking for server on port %PORT%...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-backend-port.ps1" -Port %PORT%
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo  Done. Port %PORT% should now be free.
  echo  You can run start-backend.bat again.
) else (
  echo  Could not stop the process on port %PORT%.
  echo  Try: right-click this file ^> Run as administrator
  echo  Or close any open "SMS Automation Backend" window manually.
)
echo.
pause
exit /b %EXIT_CODE%
