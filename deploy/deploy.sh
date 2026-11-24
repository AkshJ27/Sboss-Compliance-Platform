#!/usr/bin/env bash
# Updates the server to the latest code on GitHub: run on the server with  ./deploy/deploy.sh
set -euo pipefail

APP_DIR=/opt/sboss-compliance
WEB_DIR=/var/www/sboss-compliance

cd "$APP_DIR"
echo "== Getting the latest code"
git pull --ff-only origin main

echo "== Backend: packages, database changes, build"
cd "$APP_DIR/backend"
npm ci --no-audit --no-fund
npx prisma generate
npx prisma migrate deploy
npm run build

echo "== Frontend: packages and build"
cd "$APP_DIR/frontend"
npm ci --no-audit --no-fund
npm run build
sudo mkdir -p "$WEB_DIR"
sudo rsync -a --delete dist/ "$WEB_DIR/"

echo "== Web server security settings"
sudo cp "$APP_DIR/deploy/sboss-security-headers.conf" /etc/nginx/snippets/sboss-security-headers.conf
# Hide the Nginx version: nginx.conf already has a server_tokens line, so set that one to off
sudo rm -f /etc/nginx/conf.d/sboss-hardening.conf
sudo sed -i -E 's/^(\s*)server_tokens\s+\S+;/\1server_tokens off;/' /etc/nginx/nginx.conf
sudo nginx -t
sudo systemctl reload nginx
echo "== Restarting the server"
sudo systemctl restart sboss-compliance-api
sleep 5
curl -fsS http://127.0.0.1:4000/health/db && echo && echo "== Done: the server is up and connected to the database"