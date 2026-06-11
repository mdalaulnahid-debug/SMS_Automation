@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

title SMS Automation — Telegram Setup

echo.
echo  Telegram Bot Setup
echo  ==================
echo  This will create config\telegram.json step by step.
echo.

if exist "config\telegram.json" (
  echo  config\telegram.json already exists.
  set /p OVERWRITE="  Overwrite it? (y/N): "
  if /i not "!OVERWRITE!"=="y" (
    echo  Cancelled.
    pause
    exit /b 0
  )
)

echo.
echo  STEP 1 — Create your bot
echo  ------------------------
echo  1. Open Telegram and search for @BotFather
echo  2. Send:  /newbot
echo  3. Enter a name (e.g. "SMS Lookup Bot")
echo  4. Enter a username ending in 'bot' (e.g. "sms_lookup_bd_bot")
echo  5. BotFather replies with a token like: 123456789:ABCdef...
echo.
set /p BOT_TOKEN="  Paste the bot token here: "
if "!BOT_TOKEN!"=="" (
  echo  Token cannot be blank.
  pause
  exit /b 1
)

echo.
echo  STEP 2 — Disable group privacy
echo  --------------------------------
echo  In BotFather, send:  /setprivacy
echo  Select your bot, then choose:  Disable
echo  (This lets the bot read all group messages, not just commands)
echo.
pause

echo.
echo  STEP 3 — Add bot to your Telegram group
echo  -----------------------------------------
echo  1. Open the group in Telegram
echo  2. Tap group name ^> Add Members ^> search your bot username
echo  3. Add it and make it an Admin (so it can read + post messages)
echo.
pause

echo.
echo  STEP 4 — Get the group chat ID
echo  --------------------------------
echo  1. Send any message in the group (e.g. "test")
echo  2. Open this URL in your browser (replace TOKEN with yours):
echo     https://api.telegram.org/bot!BOT_TOKEN!/getUpdates
echo  3. Look for "chat":{"id": -1001234567890  ^<-- that negative number is your group ID
echo.
set /p GROUP_ID="  Paste the group chat ID (negative number): "
if "!GROUP_ID!"=="" (
  echo  Group ID cannot be blank.
  pause
  exit /b 1
)

echo.
echo  STEP 5 — Add authorized officers
echo  ----------------------------------
echo  Each officer needs their Telegram numeric user ID.
echo  Ask each officer to message @userinfobot on Telegram — it replies with their ID.
echo.
echo  You can add more later by editing config\telegram.json directly.
echo.

set USERS_JSON={}
set USER_COUNT=0

:add_user
set /p USER_ID="  Officer Telegram user ID (or press Enter to finish): "
if "!USER_ID!"=="" goto done_users
set /p USER_NAME="  Officer name: "
if "!USER_NAME!"=="" set "USER_NAME=Officer !USER_COUNT!"

if !USER_COUNT!==0 (
  set "USERS_JSON={"!USER_ID!": {"name": "!USER_NAME!", "allowedOperators": ["GP", "ROBI", "BANGLALINK"]}}"
) else (
  :: For simplicity just overwrite — user can add more in the JSON directly
  set "USERS_JSON={"!USER_ID!": {"name": "!USER_NAME!", "allowedOperators": ["GP", "ROBI", "BANGLALINK"]}}"
)
set /a USER_COUNT+=1
echo  Added !USER_NAME! (!USER_ID!)
goto add_user

:done_users

echo.
echo  STEP 6 — Admin API key
echo  -----------------------
set "ADMIN_KEY="
if exist "config\auth.json" (
  for /f "tokens=2 delims=:, " %%a in ('findstr "adminApiKey" config\auth.json 2^>nul') do (
    set "ADMIN_KEY=%%~a"
  )
)
if defined ADMIN_KEY (
  echo  Found existing adminApiKey in config\auth.json — using it.
) else (
  set /p ADMIN_KEY="  Admin API key (must match config\auth.json, or leave blank for dev mode): "
)

echo.
echo  STEP 7 — Auto-approve replies?
echo  --------------------------------
echo  When ON: operator replies are posted to the group automatically (no manual review).
echo  When OFF: someone must approve each reply on the dashboard first.
echo  Recommended: ON for fast investigation response.
echo.
set /p AUTO_APPROVE="  Auto-approve replies? (Y/n): "
set "AUTO_APPROVE_VAL=true"
if /i "!AUTO_APPROVE!"=="n" set "AUTO_APPROVE_VAL=false"

echo.
echo  Writing config\telegram.json...

(
  echo {
  echo   "botToken": "!BOT_TOKEN!",
  echo   "groupChatId": !GROUP_ID!,
  echo   "backendUrl": "http://localhost:3000",
  echo   "adminApiKey": "!ADMIN_KEY!",
  echo   "pollPostIntervalMs": 3000,
  echo   "autoApprove": !AUTO_APPROVE_VAL!,
  echo   "ackOnIntake": true,
  echo   "replyToUnauthorized": true,
  echo   "authorizedUsers": !USERS_JSON!
  echo }
) > "config\telegram.json"

echo.
echo  =============================================
echo   config\telegram.json created successfully!
echo  =============================================
echo.
echo  NEXT STEPS:
echo  1. Edit config\telegram.json to add more authorized users if needed
echo  2. Run start-all.bat to launch the backend + Telegram bridge together
echo  3. Send a test request in your group, e.g.: LRL 01700000001
echo.
pause
