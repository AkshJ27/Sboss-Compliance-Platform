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

echo "== Restarting the server"
sudo systemctl restart sboss-compliance-api
sleep 5
curl -fsS http://127.0.0.1:4000/health/db && echo && echo "== Done: the server is up and connected to the database"