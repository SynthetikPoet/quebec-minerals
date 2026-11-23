#!/usr/bin/env bash
# Запуск Klim на Linux/macOS: ставит зависимости, при необходимости качает данные SIGÉOM,
# собирает и открывает приложение на http://localhost:4173
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Нужен Node.js ≥ 20: https://nodejs.org (или: sudo apt install nodejs npm)" >&2
  exit 1
fi

[ -d node_modules ] || npm install
[ -f public/data/metallic.geojson ] || npm run fetch-data

npm run build
URL="http://localhost:4173"
( sleep 2; command -v xdg-open >/dev/null && xdg-open "$URL" || command -v open >/dev/null && open "$URL" ) >/dev/null 2>&1 &
echo "Klim: $URL  (Ctrl+C — остановить)"
exec npx vite preview --port 4173
