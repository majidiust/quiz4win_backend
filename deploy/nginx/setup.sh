#!/usr/bin/env bash
# deploy/nginx/setup.sh
#
# Installs nginx configs for panel.quiz4win.com, api.quiz4win.com, and app.quiz4win.com,
# obtains Let's Encrypt TLS certificates via certbot (webroot method),
# and reloads nginx.
#
# Run on the host as root (or with sudo):
#   sudo bash deploy/nginx/setup.sh
#
# Prerequisites on the host:
#   - nginx installed  (apt install nginx  /  yum install nginx)
#   - certbot installed (apt install certbot python3-certbot-nginx)
#   - Both DNS A records pointing to this server's public IP
#   - Ports 80 and 443 open in the firewall

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
DOMAINS=("panel.quiz4win.com" "api.quiz4win.com" "app.quiz4win.com")
EMAIL="${CERTBOT_EMAIL:-}"               # set env var or pass below
NGINX_CONF_DIR="/etc/nginx/sites-available"
NGINX_ENABLED_DIR="/etc/nginx/sites-enabled"
WEBROOT="/var/www/certbot"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Helpers ─────────────────────────────────────────────────────────────────
info()  { echo -e "\033[1;34m[INFO]\033[0m  $*"; }
ok()    { echo -e "\033[1;32m[ OK ]\033[0m  $*"; }
die()   { echo -e "\033[1;31m[ERR ]\033[0m  $*" >&2; exit 1; }

require_root() {
    [[ $EUID -eq 0 ]] || die "This script must be run as root (try: sudo $0)"
}

require_cmd() {
    command -v "$1" &>/dev/null || die "'$1' not found — install it first."
}

# ─── Preflight ───────────────────────────────────────────────────────────────
require_root
require_cmd nginx
require_cmd certbot

if [[ -z "$EMAIL" ]]; then
    read -rp "Enter your email for Let's Encrypt notifications: " EMAIL
fi
[[ "$EMAIL" == *@* ]] || die "Invalid email: $EMAIL"

# ─── 1. Create webroots ──────────────────────────────────────────────────────
info "Creating ACME webroot $WEBROOT"
mkdir -p "$WEBROOT"

# Note: Universal Link / App Link manifest files are now served by the
# quiz4win-app Docker container (see app/public/.well-known/). No host
# webroot is required for app.quiz4win.com anymore.

# ─── 2. Install HTTP-only bootstrap configs (port 80 only) ───────────────────
# We need nginx to serve /.well-known/acme-challenge/ BEFORE we have certs.
# Use a minimal inline config so certbot can complete the challenge.
install_bootstrap() {
    local domain="$1"
    local bootstrap="/tmp/nginx-bootstrap-${domain}.conf"
    cat > "$bootstrap" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    root ${WEBROOT};
    location /.well-known/acme-challenge/ { try_files \$uri =404; }
    location / { return 301 https://\$host\$request_uri; }
}
NGINX
    cp "$bootstrap" "${NGINX_CONF_DIR}/${domain}.conf"
    rm -f "${NGINX_ENABLED_DIR}/${domain}.conf"
    ln -sf "${NGINX_CONF_DIR}/${domain}.conf" "${NGINX_ENABLED_DIR}/${domain}.conf"
    info "Bootstrap config installed for ${domain}"
}

for domain in "${DOMAINS[@]}"; do
    install_bootstrap "$domain"
done

nginx -t && nginx -s reload
ok "nginx reloaded with bootstrap configs"

# ─── 3. Obtain certificates ──────────────────────────────────────────────────
for domain in "${DOMAINS[@]}"; do
    if [[ -f "/etc/letsencrypt/live/${domain}/fullchain.pem" ]]; then
        info "Certificate for ${domain} already exists — skipping issuance"
        continue
    fi
    info "Requesting certificate for ${domain}"
    certbot certonly \
        --webroot \
        --webroot-path "$WEBROOT" \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        -d "$domain"
    ok "Certificate issued for ${domain}"
done

# ─── 4. Install final TLS configs ────────────────────────────────────────────
for domain in "${DOMAINS[@]}"; do
    src="${SCRIPT_DIR}/${domain}.conf"
    [[ -f "$src" ]] || die "Config file not found: $src"
    cp "$src" "${NGINX_CONF_DIR}/${domain}.conf"
    ln -sf "${NGINX_CONF_DIR}/${domain}.conf" "${NGINX_ENABLED_DIR}/${domain}.conf"
    info "TLS config installed for ${domain}"
done

# ─── 5. Test & reload nginx ──────────────────────────────────────────────────
nginx -t || die "nginx config test failed — fix the errors above and re-run."
nginx -s reload
ok "nginx reloaded with TLS configs"

# ─── 6. Auto-renew cron (idempotent) ─────────────────────────────────────────
CRON_JOB="0 3 * * * certbot renew --quiet --post-hook 'nginx -s reload'"
if crontab -l 2>/dev/null | grep -qF "certbot renew"; then
    info "certbot renew cron already present — skipping"
else
    ( crontab -l 2>/dev/null; echo "$CRON_JOB" ) | crontab -
    ok "Auto-renew cron installed (runs at 03:00 daily)"
fi

echo ""
ok "Setup complete!"
echo "  panel.quiz4win.com → https://panel.quiz4win.com  (→ 127.0.0.1:5800, quiz4win-admin)"
echo "  app.quiz4win.com   → https://app.quiz4win.com    (→ 127.0.0.1:5801, quiz4win-app)"
echo "  api.quiz4win.com   → https://api.quiz4win.com    (→ 127.0.0.1:5802, quiz4win-api)"
echo ""
echo "  Universal Link manifests are served by the quiz4win-app container from"
echo "  app/public/.well-known/ — edit those files (TEAM_ID, SHA-256 fingerprint)"
echo "  and run 'docker compose build app && docker compose up -d app' to publish."
echo ""
echo "  Start the Docker services if not already running:"
echo "    docker compose up -d"
