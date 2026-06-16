#!/bin/bash
# Run from your Windows machine via Git Bash: bash scripts/deploy.sh
set -e

VPS="root@45.77.240.195"
REMOTE="/opt/sms-backend"

echo "==> Deploying to $VPS..."

# Copy backend source files
echo "==> Copying source files..."
scp src/domain.js       "$VPS:$REMOTE/src/domain.js"
scp src/store.js        "$VPS:$REMOTE/src/store.js"
scp src/persistence.js  "$VPS:$REMOTE/src/persistence.js"
scp src/app.js          "$VPS:$REMOTE/src/app.js"
scp src/server.js       "$VPS:$REMOTE/src/server.js"
scp src/service.js      "$VPS:$REMOTE/src/service.js"
scp src/parser.js       "$VPS:$REMOTE/src/parser.js"
scp src/auth.js         "$VPS:$REMOTE/src/auth.js"

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

# Copy package.json and install dependencies
echo "==> Updating dependencies..."
scp package.json "$VPS:$REMOTE/package.json"
ssh "$VPS" "cd $REMOTE && npm install --omit=dev --quiet"

# Copy nginx config and scripts
echo "==> Copying nginx config and scripts..."
ssh "$VPS" "mkdir -p $REMOTE/nginx $REMOTE/scripts $REMOTE/backups"
scp nginx/sms-backend.conf   "$VPS:$REMOTE/nginx/sms-backend.conf"
scp scripts/setup-ssl.sh     "$VPS:$REMOTE/scripts/setup-ssl.sh"
scp scripts/backup.sh        "$VPS:$REMOTE/scripts/backup.sh"
ssh "$VPS" "chmod +x $REMOTE/scripts/setup-ssl.sh $REMOTE/scripts/backup.sh"

# Copy gitignored config files
echo "==> Copying config files..."
scp config/telegram.json "$VPS:$REMOTE/config/telegram.json"

# Restart both processes
echo "==> Restarting services..."
ssh "$VPS" "pm2 restart sms-backend sms-bridge && pm2 status"

# Install nightly backup cron (idempotent)
echo "==> Installing nightly backup cron..."
ssh "$VPS" "cp $REMOTE/scripts/backup.sh /etc/cron.daily/sms-backup && chmod +x /etc/cron.daily/sms-backup"

echo ""
echo "===== Deploy complete ====="
echo ""
echo "If TLS is not yet set up, run on the VPS:"
echo "  ssh root@45.77.240.195 \"bash $REMOTE/scripts/setup-ssl.sh your-domain.com\""
echo "  (Free domain at https://www.duckdns.org)"
