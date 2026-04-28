#!/usr/bin/env bash
set -euo pipefail

cd /opt/soundspa-app

echo "[post-deploy] Updating/running docker-compose app container..."
docker-compose pull app || true
docker-compose up -d app

# Можно добавить ожидание, если нужен healthcheck контейнера, сейчас просто пауза
sleep 5

echo "[post-deploy] Restarting PM2 worker inside container..."
docker-compose exec app npx pm2 kill || true
docker-compose exec app npx pm2 start scripts/worker.ts \
  --name soundspa-worker \
  --interpreter npx \
  --interpreter-args "tsx"
docker-compose exec app npx pm2 save

echo "[post-deploy] Done. PM2 status:"
docker-compose exec app npx pm2 status