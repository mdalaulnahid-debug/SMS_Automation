#!/bin/bash
# Run from your Windows machine via Git Bash: bash scripts/deploy.sh
set -e

VPS="root@45.77.240.195"
REMOTE="/opt/sms-backend"

echo "==> Deploying to $VPS..."

# Copy backend source files directly
echo "==> Copying source files..."
scp src/domain.js     "$VPS:$REMOTE/src/domain.js"
scp src/store.js      "$VPS:$REMOTE/src/store.js"
scp src/app.js        "$VPS:$REMOTE/src/app.js"
scp src/service.js    "$VPS:$REMOTE/src/service.js"
scp src/parser.js     "$VPS:$REMOTE/src/parser.js"

# Copy web dashboard
echo "==> Copying dashboard..."
scp public/index.html        "$VPS:$REMOTE/public/index.html"
scp public/app.js            "$VPS:$REMOTE/public/app.js"
scp public/app-version.json  "$VPS:$REMOTE/public/app-version.json"

# Copy Telegram bridge files
echo "==> Copying bridge files..."
scp telegram-bridge/bridge.js         "$VPS:$REMOTE/telegram-bridge/bridge.js"
scp telegram-bridge/backendClient.js  "$VPS:$REMOTE/telegram-bridge/backendClient.js"
scp telegram-bridge/telegramClient.js "$VPS:$REMOTE/telegram-bridge/telegramClient.js"
scp telegram-bridge/start.js          "$VPS:$REMOTE/telegram-bridge/start.js"

# Copy package.json and install new dependencies (qrcode)
echo "==> Updating dependencies..."
scp package.json "$VPS:$REMOTE/package.json"
ssh "$VPS" "cd $REMOTE && npm install --omit=dev --quiet"

# Copy gitignored config files
echo "==> Copying config files..."
scp config/telegram.json "$VPS:$REMOTE/config/telegram.json"

# Restart both processes
echo "==> Restarting services..."
ssh "$VPS" "pm2 restart sms-backend sms-bridge && pm2 status"

echo ""
echo "===== Deploy complete ====="
