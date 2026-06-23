#!/bin/bash
# Run from your Windows machine via Git Bash: bash scripts/deploy.sh
set -euo pipefail

VPS="root@45.77.240.195"
REMOTE="/opt/sms-backend"

echo "==> Deploying to $VPS..."

echo "==> Ensuring remote directories..."
ssh "$VPS" "mkdir -p \
  $REMOTE/src \
  $REMOTE/public/assets \
  $REMOTE/telegram-bridge \
  $REMOTE/scripts \
  $REMOTE/nginx \
  $REMOTE/config \
  $REMOTE/data/training-cache \
  $REMOTE/data/manual-review \
  '$REMOTE/Training Data/Automation' \
  $REMOTE/backups"

echo "==> Copying backend source..."
scp src/*.js "$VPS:$REMOTE/src/"

echo "==> Copying dashboard and setup pages..."
find public -maxdepth 1 -type f -exec scp {} "$VPS:$REMOTE/public/" \;
scp public/assets/* "$VPS:$REMOTE/public/assets/"

echo "==> Copying Telegram bridge..."
scp telegram-bridge/*.js "$VPS:$REMOTE/telegram-bridge/"

echo "==> Copying curated training workbooks (source of truth for the training cache)..."
scp "Training Data/Automation/"*.xlsx "$VPS:$REMOTE/Training Data/Automation/"

echo "==> Copying generated training cache and review-store docs..."
scp data/training-cache/*.json "$VPS:$REMOTE/data/training-cache/"
scp data/training-summary.json "$VPS:$REMOTE/data/training-summary.json"
scp data/manual-review/README.md "$VPS:$REMOTE/data/manual-review/README.md"

echo "==> Copying runtime package and scripts..."
scp package.json "$VPS:$REMOTE/package.json"
scp nginx/sms-backend.conf "$VPS:$REMOTE/nginx/sms-backend.conf"
scp scripts/*.js "$VPS:$REMOTE/scripts/"
scp scripts/setup-ssl.sh "$VPS:$REMOTE/scripts/setup-ssl.sh"
scp scripts/backup.sh "$VPS:$REMOTE/scripts/backup.sh"
ssh "$VPS" "chmod +x $REMOTE/scripts/setup-ssl.sh $REMOTE/scripts/backup.sh"

echo "==> Ensuring config/telegram.json exists on the VPS (first-time bootstrap only)..."
# Once a file exists on the VPS, it's runtime-owned by the admin console/app (Telegram
# group id, operator hotline numbers, authorized DM users) — NEVER overwrite it on every
# deploy. Doing so used to silently wipe out runtime edits (e.g. authorizedUsers added via
# the admin console) back to whatever stale state happens to be on this machine's disk.
ssh "$VPS" "[ -f $REMOTE/config/telegram.json ]" || scp config/telegram.json "$VPS:$REMOTE/config/telegram.json"

echo "==> Installing production dependencies..."
ssh "$VPS" "cd $REMOTE && npm install --omit=dev --quiet"

echo "==> Restarting PM2 services..."
ssh "$VPS" "pm2 restart sms-backend sms-bridge && pm2 status"

echo "==> Installing nightly backup cron..."
ssh "$VPS" "cp $REMOTE/scripts/backup.sh /etc/cron.daily/sms-backup && chmod +x /etc/cron.daily/sms-backup"

echo
echo "===== Deploy complete ====="
