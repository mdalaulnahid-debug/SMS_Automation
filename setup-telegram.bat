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
echo  In BotFather send:  /setprivacy
echo  Select your bot, then choose:  Disable
echo  (This lets the bot read all group messages, not just commands)
echo.
pause

echo.
echo  STEP 3 — Add bot to your Telegram group
echo  -----------------------------------------
echo  1. Open the group in Telegram
echo  2. Tap group name ^> Add Members ^> search your bot username
echo  3. Add it and make it Admin (so it can post messages)
echo.
pause

echo.
echo  STEP 4 — Get the group chat ID
echo  --------------------------------
echo  1. Send any message in the group
echo  2. Open this URL in a browser (replace TOKEN):
echo     https://api.telegram.org/bot!BOT_TOKEN!/getUpdates
echo  3. Find  "chat":{"id": -100xxxxxxxxxx  ^(negative number^)
echo.
set /p GROUP_ID="  Paste the group chat ID: "
if "!GROUP_ID!"=="" (
  echo  Group ID cannot be blank.
  pause
  exit /b 1
)

echo.
echo  STEP 5 — Test phone number
echo  ---------------------------
echo  For testing, all requests will be sent to ONE phone number as SMS.
echo  That phone replies back, and the bot posts the reply to the group.
echo  Use a personal SIM you can reply from (e.g. your own number).
echo  In production, leave this blank and set real shortcodes in gateways.json.
echo.
set /p TEST_DEST="  Test phone number (e.g. 01712345678, or blank to skip): "

echo.
echo  STEP 6 — Add authorized officers
echo  ----------------------------------
echo  Each officer needs their Telegram numeric user ID.
echo  Ask each officer to message @userinfobot on Telegram — it replies with their ID.
echo.

set "USERS_JSON="
set USER_COUNT=0

:add_user
set /p USER_ID="  Officer Telegram user ID (press Enter when done): "
if "!USER_ID!"=="" goto done_users
set /p USER_NAME="  Officer name: "
if "!USER_NAME!"=="" set "USER_NAME=Officer"

if !USER_COUNT!==0 (
  set "USERS_JSON=!USERS_JSON!, "!USER_ID!": {"name": "!USER_NAME!", "allowedOperators": ["GP", "ROBI", "BANGLALINK"]}"
) else (
  set "USERS_JSON="!USER_ID!": {"name": "!USER_NAME!", "allowedOperators": ["GP", "ROBI", "BANGLALINK"]}"
)
set /a USER_COUNT+=1
echo  Added !USER_NAME! ^(!USER_ID!^)
goto add_user

:done_users
if "!USERS_JSON!"=="" (
  echo  WARNING: No authorized users added. You can edit config\telegram.json manually to add them.
  set "USERS_JSON="000000000": {"name": "REPLACE_ME", "allowedOperators": ["GP", "ROBI", "BANGLALINK"]}"
)

echo.
echo  STEP 7 — Admin API key
echo  -----------------------
set "ADMIN_KEY="
if exist "config\auth.json" (
  for /f "tokens=*" %%a in ('powershell -NoProfile -Command "(Get-Content config\auth.json | ConvertFrom-Json).adminApiKey" 2^>nul') do set "ADMIN_KEY=%%a"
)
if defined ADMIN_KEY (
  echo  Found existing adminApiKey in config\auth.json — reusing it.
) else (
  set /p ADMIN_KEY="  Admin API key (leave blank for dev/test mode): "
)

echo.
echo  STEP 8 — Auto-approve replies?
echo  --------------------------------
echo  ON  = replies post to group instantly (recommended for testing)
echo  OFF = someone must approve each reply on the dashboard first
echo.
set /p AUTO_APPROVE="  Auto-approve replies? (Y/n): "
set "AUTO_APPROVE_VAL=true"
if /i "!AUTO_APPROVE!"=="n" set "AUTO_APPROVE_VAL=false"

echo.
echo  Writing config\telegram.json...

set "TEST_DEST_LINE="
if not "!TEST_DEST!"=="" (
  set "TEST_DEST_LINE=  "testDestination": "!TEST_DEST!","
)

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
  if not "!TEST_DEST!"=="" echo   "testDestination": "!TEST_DEST!",
  echo   "authorizedUsers": { !USERS_JSON! }
  echo }
) > "config\telegram.json"

:: Add test number to gateways.json trustedSenders if provided
if not "!TEST_DEST!"=="" (
  if exist "config\gateways.json" (
    echo.
    echo  Adding !TEST_DEST! to trustedSenders in config\gateways.json...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$g = Get-Content 'config\gateways.json' | ConvertFrom-Json; $num = '!TEST_DEST!'; foreach ($op in $g.PSObject.Properties) { if ($op.Value.trustedSenders -notcontains $num) { $op.Value.trustedSenders += $num } }; $g | ConvertTo-Json -Depth 5 | Set-Content 'config\gateways.json' -Encoding utf8"
    echo  Done.
  ) else (
    echo.
    echo  NOTE: config\gateways.json not found yet.
    echo  When start-all.bat creates it, manually add !TEST_DEST! to trustedSenders.
  )
)

echo.
echo  =============================================
echo   config\telegram.json created successfully!
echo  =============================================
echo.
echo  NEXT STEPS:
echo  1. Run start-all.bat to launch backend + Telegram bridge
echo  2. Send a test message in your group, e.g.:  LRL 01700000001
echo  3. The gateway phone sends SMS to !TEST_DEST!
echo  4. Reply from that number — bot posts the reply back in-thread
echo.
pause
