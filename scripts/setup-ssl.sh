#!/bin/bash
# scripts/setup-ssl.sh
# Run on the VPS as root after deploying: ssh root@VPS "bash /opt/sms-backend/scripts/setup-ssl.sh your-domain.com"
#
# PREREQUISITES
#   1. A domain or subdomain pointed at your VPS IP (A record).
#      Free option: https://www.duckdns.org — takes ~2 minutes.
#      Example: sms-gateway.duckdns.org → 45.77.240.195
#   2. Port 80 and 443 open in the VPS firewall (ufw allow 80; ufw allow 443).
#   3. This script must be run as root.
#
# WHAT THIS DOES
#   - Installs nginx + certbot (if not already installed)
#   - Deploys the nginx config from /opt/sms-backend/nginx/sms-backend.conf
#   - Obtains a Let's Encrypt certificate for your domain
#   - Enables auto-renewal via systemd timer
#   - Restricts Node.js to localhost-only (it no longer needs to be internet-facing)
#
set -euo pipefail

DOMAIN="${1:-}"
REMOTE="/opt/sms-backend"
EMAIL="${2:-admin@${DOMAIN}}"

if [ -z "$DOMAIN" ]; then
    echo "Usage: bash setup-ssl.sh <your-domain.com> [admin-email]"
    echo ""
    echo "Example:"
    echo "  bash setup-ssl.sh sms-gateway.duckdns.org"
    echo ""
    echo "Get a free subdomain at https://www.duckdns.org"
    exit 1
fi

echo "==> Setting up TLS for $DOMAIN ..."

# ── Install dependencies ──────────────────────────────────────────────────────
apt-get update -q
apt-get install -y -q nginx certbot python3-certbot-nginx

# ── Block direct internet access to Node.js (port 3000) ──────────────────────
# Node.js should only be reachable via nginx (localhost).
ufw deny 3000 2>/dev/null || true

# Allow web ports if ufw is active.
if ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp
    ufw allow 443/tcp
fi

# ── Deploy nginx config ───────────────────────────────────────────────────────
mkdir -p /var/www/certbot
sed "s/YOUR_DOMAIN/$DOMAIN/g" "$REMOTE/nginx/sms-backend.conf" \
    > /etc/nginx/sites-available/sms-backend

ln -sf /etc/nginx/sites-available/sms-backend /etc/nginx/sites-enabled/sms-backend
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx

# ── Obtain Let's Encrypt certificate ─────────────────────────────────────────
certbot --nginx \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --redirect

# ── Verify auto-renewal ───────────────────────────────────────────────────────
systemctl enable --now certbot.timer 2>/dev/null \
    || (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet") | crontab -

# ── Bind Node.js to localhost only ───────────────────────────────────────────
# If PM2 is managing the process, update the HOST env var and restart.
if command -v pm2 &>/dev/null; then
    pm2 set sms-backend:HOST 127.0.0.1 2>/dev/null || true
    # The HOST env var in the Node process takes effect on next pm2 restart.
    # server.js reads: const host = process.env.HOST || '0.0.0.0';
    echo "==> Restarting sms-backend with HOST=127.0.0.1 ..."
    HOST=127.0.0.1 pm2 restart sms-backend --update-env
fi

echo ""
echo "============================================================"
echo "  TLS SETUP COMPLETE"
echo "  Backend URL:  https://$DOMAIN"
echo ""
echo "  Next steps on your gateway phones:"
echo "    Settings → ADMIN SETUP (PIN) → Backend URL:"
echo "    Change http://... to https://$DOMAIN"
echo "    Tap 'Test Connection' to verify."
echo "============================================================"
