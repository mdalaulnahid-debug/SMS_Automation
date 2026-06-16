#!/bin/bash
# scripts/setup-ssl.sh
# Run on the VPS as root:
#   ssh root@45.77.240.195 "bash /opt/sms-backend/scripts/setup-ssl.sh your-domain.duckdns.org"
#
# PREREQUISITES
#   1. A domain/subdomain A-record pointing at your VPS IP.
#      Free option: https://www.duckdns.org (takes ~2 min).
#      Example: sms-gateway.duckdns.org → 45.77.240.195
#   2. Port 80 and 443 open on the VPS firewall.
#   3. Run as root.
#
set -euo pipefail

DOMAIN="${1:-}"
REMOTE="/opt/sms-backend"
EMAIL="${2:-noreply@${DOMAIN}}"

if [ -z "$DOMAIN" ]; then
    echo "Usage: bash setup-ssl.sh <your-domain.com> [admin-email]"
    echo ""
    echo "Example:  bash setup-ssl.sh sms-gateway.duckdns.org"
    echo "Free domain: https://www.duckdns.org"
    exit 1
fi

echo "==> Setting up TLS for $DOMAIN ..."

# ── Install dependencies ──────────────────────────────────────────────────────
apt-get update -q
apt-get install -y -q nginx certbot python3-certbot-nginx

# ── Open firewall ports ───────────────────────────────────────────────────────
if ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 80/tcp
    ufw allow 443/tcp
fi

# ── PHASE 1: HTTP-only config so certbot can complete the ACME challenge ──────
# The HTTPS server block must NOT exist yet — nginx can't start with cert paths
# that don't exist.  We add HTTPS in Phase 2 after the cert is on disk.

mkdir -p /var/www/certbot

cat > /etc/nginx/sites-available/sms-backend <<HTTPONLY
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # ACME challenge directory (used by certbot to prove domain ownership).
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Everything else: accept for now (will become a redirect after Phase 2).
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
HTTPONLY

ln -sf /etc/nginx/sites-available/sms-backend /etc/nginx/sites-enabled/sms-backend
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx
echo "==> Phase 1: HTTP nginx running."

# ── Obtain the certificate (webroot mode — does NOT modify nginx config) ──────
certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL"

echo "==> Certificate obtained at /etc/letsencrypt/live/$DOMAIN/"

# ── PHASE 2: Full TLS nginx config ───────────────────────────────────────────
sed "s/YOUR_DOMAIN/$DOMAIN/g" "$REMOTE/nginx/sms-backend.conf" \
    > /etc/nginx/sites-available/sms-backend

nginx -t
systemctl reload nginx
echo "==> Phase 2: HTTPS nginx active."

# ── Enable auto-renewal ───────────────────────────────────────────────────────
systemctl enable --now certbot.timer 2>/dev/null || \
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") \
    | crontab -

# ── Bind Node.js to localhost only (it must not be directly internet-reachable) ─
ufw deny 3000 2>/dev/null || true
if command -v pm2 &>/dev/null; then
    echo "==> Restarting sms-backend with HOST=127.0.0.1 ..."
    HOST=127.0.0.1 pm2 restart sms-backend --update-env
fi

echo ""
echo "============================================================"
echo "  TLS SETUP COMPLETE"
echo "  Backend URL:  https://$DOMAIN"
echo ""
echo "  On each gateway phone:"
echo "    Settings → ADMIN SETUP (PIN) → Backend URL"
echo "    Change to: https://$DOMAIN"
echo "    Tap 'Test Connection' to verify."
echo "============================================================"
