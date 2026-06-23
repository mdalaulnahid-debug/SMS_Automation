#!/bin/bash
# scripts/setup-ssl.sh
# Run on the VPS as root:
#   ssh root@45.77.240.195 "bash /opt/sms-backend/scripts/setup-ssl.sh domain1.com [domain2.com ...]"
#
# Each domain gets its OWN independent Let's Encrypt certificate (skipped if
# it already has one) and its own nginx HTTPS server block (picked by SNI).
# Pass multiple domains for a zero-downtime migration — all of them serve
# simultaneously; drop one later by re-running with only the domains you
# want to keep (this rewrites nginx but never touches an existing domain's
# certificate).
#
# (Earlier version tried one shared SAN cert via `certbot --expand`, but hit
# a reproducible 405 from Let's Encrypt's finalize step specific to expanding
# an existing cert's domain list — independent per-domain certs sidestep it
# entirely and are simpler to reason about: each domain renews on its own.)
#
# PREREQUISITES
#   1. Every domain/subdomain listed must have an A-record pointing at this
#      VPS IP already (DNS propagated) before running this.
#   2. Port 80 and 443 open on the VPS firewall.
#   3. Run as root.
#
# Admin console access: no IP restriction — protected only by the admin API
# key (src/auth.js).
set -euo pipefail

DOMAINS=("$@")
EMAIL="${SSL_EMAIL:-noreply@${DOMAINS[0]:-example.com}}"

if [ "${#DOMAINS[@]}" -eq 0 ]; then
    echo "Usage: bash setup-ssl.sh <domain1.com> [domain2.com ...]"
    echo ""
    echo "First-time setup:       bash setup-ssl.sh opsbarishal.com"
    echo "Zero-downtime migration: bash setup-ssl.sh licbarishal.duckdns.org opsbarishal.com"
    echo "  (each domain keeps/gets its own independent certificate)"
    echo ""
    echo "Override the certbot contact email with SSL_EMAIL=you@example.com"
    exit 1
fi

ALL_DOMAINS_SPACED="${DOMAINS[*]}"
echo "==> Setting up TLS for: ${ALL_DOMAINS_SPACED} (one independent cert per domain) ..."

# ── Install dependencies ──────────────────────────────────────────────────────
apt-get update -q
apt-get install -y -q nginx certbot

# ── Open firewall ports ───────────────────────────────────────────────────────
if ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 80/tcp
    ufw allow 443/tcp
fi

mkdir -p /var/www/certbot

# ── PHASE 1: HTTP-only config covering ALL domains, so certbot's HTTP-01 ─────
# challenge has somewhere to land for any domain that doesn't have a cert
# yet. Harmless to rewrite every run — Phase 2 replaces it immediately after.
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
echo "==> Phase 1: HTTP nginx running for ${ALL_DOMAINS_SPACED}."

# ── Obtain a certificate for each domain that doesn't already have one ───────
for d in "${DOMAINS[@]}"; do
    if [ -f "/etc/letsencrypt/live/$d/fullchain.pem" ]; then
        echo "==> $d already has a certificate — leaving it untouched."
        continue
    fi
    echo "==> Requesting a new certificate for $d ..."
    certbot certonly \
        --webroot \
        --webroot-path /var/www/certbot \
        -d "$d" \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL"
done

# ── PHASE 2: Full TLS nginx config — one shared HTTP redirect block, plus ───
# one HTTPS server block per domain (each with its own cert, picked by SNI).
{
cat <<REDIRECT
server {
    listen 80;
    listen [::]:80;
    server_name ${ALL_DOMAINS_SPACED};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
REDIRECT

for d in "${DOMAINS[@]}"; do
cat <<HTTPS

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name $d;

    ssl_certificate     /etc/letsencrypt/live/$d/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$d/privkey.pem;

    ssl_protocols             TLSv1.2 TLSv1.3;
    ssl_ciphers               ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout       1d;
    ssl_session_cache         shared:SSL:10m;
    ssl_session_tickets       off;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Frame-Options            DENY                                  always;
    add_header X-Content-Type-Options     nosniff                               always;
    add_header Referrer-Policy            no-referrer                           always;

    client_max_body_size 20m;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout    30s;
        proxy_connect_timeout  5s;
    }
}
HTTPS
done
} > /etc/nginx/sites-available/sms-backend

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
