#!/bin/bash
# scripts/setup-ssl.sh
# Run on the VPS as root:
#   ssh root@45.77.240.195 "bash /opt/sms-backend/scripts/setup-ssl.sh domain1.com [domain2.com ...]"
#
# One certificate, multiple domains (SAN cert). The FIRST domain given is the
# certbot lineage name and the cert directory under /etc/letsencrypt/live/ —
# pass an EXISTING domain first to expand its current cert (zero-downtime
# domain migration: old + new domain both work until you're ready to drop
# the old one), or a single new domain for a first-time setup.
#
# PREREQUISITES
#   1. Every domain/subdomain listed must have an A-record pointing at this
#      VPS IP already (DNS propagated) before running this.
#   2. Port 80 and 443 open on the VPS firewall.
#   3. Run as root.
#
# Admin console access: no IP restriction — protected only by the admin API
# key (src/auth.js). See nginx/sms-backend.conf.
set -euo pipefail

REMOTE="/opt/sms-backend"
DOMAINS=("$@")
EMAIL="${SSL_EMAIL:-noreply@${DOMAINS[0]:-example.com}}"

if [ "${#DOMAINS[@]}" -eq 0 ]; then
    echo "Usage: bash setup-ssl.sh <domain1.com> [domain2.com ...]"
    echo ""
    echo "First-time setup:        bash setup-ssl.sh opsbarishal.com"
    echo "Zero-downtime migration:  bash setup-ssl.sh licbarishal.duckdns.org opsbarishal.com"
    echo "  (first domain must already have a cert — this expands it to also cover the rest)"
    echo ""
    echo "Override the certbot contact email with SSL_EMAIL=you@example.com"
    exit 1
fi

CERT_NAME="${DOMAINS[0]}"
ALL_DOMAINS_SPACED="${DOMAINS[*]}"
CERTBOT_DOMAIN_ARGS=()
for d in "${DOMAINS[@]}"; do CERTBOT_DOMAIN_ARGS+=(-d "$d"); done

echo "==> Setting up TLS for: ${ALL_DOMAINS_SPACED} (cert name: ${CERT_NAME}) ..."

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
# that don't exist. We add HTTPS in Phase 2 after the cert is on disk. Safe to
# skip if a working HTTPS config for these domains is already live (re-runs).

mkdir -p /var/www/certbot

if [ ! -f "/etc/letsencrypt/live/${CERT_NAME}/fullchain.pem" ]; then
    cat > /etc/nginx/sites-available/sms-backend <<HTTPONLY
server {
    listen 80;
    listen [::]:80;
    server_name ${ALL_DOMAINS_SPACED};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

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
else
    echo "==> Phase 1: skipped — cert ${CERT_NAME} already exists, nginx must already be serving its ACME challenge path."
fi

# ── Obtain/expand the certificate (webroot mode — does NOT modify nginx config) ─
# --expand: if CERT_NAME's cert already exists with a different domain set,
# add the new domains to it instead of erroring. No-op for a brand new cert.
certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    "${CERTBOT_DOMAIN_ARGS[@]}" \
    --cert-name "$CERT_NAME" \
    --expand \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL"

echo "==> Certificate ready at /etc/letsencrypt/live/$CERT_NAME/ covering: ${ALL_DOMAINS_SPACED}"

# ── PHASE 2: Full TLS nginx config ───────────────────────────────────────────
sed -e "s/YOUR_DOMAINS/$ALL_DOMAINS_SPACED/g" -e "s/YOUR_CERT_NAME/$CERT_NAME/g" \
    "$REMOTE/nginx/sms-backend.conf" \
    > /etc/nginx/sites-available/sms-backend

nginx -t
systemctl reload nginx
echo "==> Phase 2: HTTPS nginx active for ${ALL_DOMAINS_SPACED}."

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
echo "  Reachable at: $(printf 'https://%s ' "${DOMAINS[@]}")"
echo ""
echo "  On each gateway phone:"
echo "    Settings → ADMIN SETUP (PIN) → Backend URL"
echo "    Change to whichever domain you're standardizing on."
echo "    Tap 'Test Connection' to verify."
echo "============================================================"
