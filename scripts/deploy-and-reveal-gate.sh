#!/bin/bash
# Run from your Windows machine via Git Bash: bash scripts/deploy-and-reveal-gate.sh
#
# Combines the normal deploy with the one follow-up step this particular
# release needs: grabbing the hidden super-admin sign-in URL from the fresh
# boot log. That URL is random and only ever printed once, right after the
# server restarts with this code for the first time — miss it here and
# you'll need a separate SSH session to `pm2 logs` for it later.
set -euo pipefail

VPS="root@45.77.240.195"

bash "$(dirname "$0")/deploy.sh"

echo
echo "==> Looking for the hidden super-admin sign-in URL in the fresh boot log..."
GATE_LINE=$(ssh "$VPS" "pm2 logs sms-backend --lines 200 --nostream | grep 'super-admin gate' | tail -1" || true)

if [ -z "$GATE_LINE" ]; then
  echo "  Could not find it in the last 200 log lines — the account may already have"
  echo "  existed before this deploy (the URL is only logged on first creation, not"
  echo "  every boot). Run this yourself to check:"
  echo "    ssh $VPS \"pm2 logs sms-backend --lines 500 --nostream | grep 'super-admin gate'\""
else
  echo
  echo "===================================================================="
  echo "  $GATE_LINE"
  echo "===================================================================="
  echo
  echo "  Bookmark that /console/<slug> path under https://opsbarishal.com now —"
  echo "  it will not be shown again unless you rotate it from the admin console."
fi

echo
echo "===== Deploy + gate lookup complete ====="
