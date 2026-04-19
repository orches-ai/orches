#!/bin/bash

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/orches"
FRONTEND="$APP/frontend"

MODE="${1:-ui}"   # ui | cli

# ── Bootstrap .env ────────────────────────────────────────────
if [ ! -f "$APP/.env" ]; then
  cp "$APP/.env.example" "$APP/.env"
  echo "  Created .env from .env.example"
fi

# ── Bootstrap venv ────────────────────────────────────────────
if [ ! -d "$APP/.venv" ]; then
  echo "  Creating virtual environment..."
  python3 -m venv "$APP/.venv"
fi

if ! "$APP/.venv/bin/pip" show fastapi > /dev/null 2>&1; then
  echo "  Installing Python dependencies..."
  "$APP/.venv/bin/pip" install -q -r "$APP/requirements.txt"
fi

# ── Start backend ─────────────────────────────────────────────
echo "  Starting orches backend..."
cd "$APP"
source .venv/bin/activate

pkill -f "uvicorn api.main:app" 2>/dev/null || true
pkill -f "python3 main.py"      2>/dev/null || true
sleep 0.3

nohup python3 main.py > /tmp/orches.log 2>&1 &
SERVER_PID=$!
echo "  Server PID: $SERVER_PID  (logs: /tmp/orches.log)"

echo -n "  Waiting for server"
for i in $(seq 1 30); do
  if curl -s http://localhost:8000/healthz > /dev/null 2>&1; then
    echo " ready"
    break
  fi
  echo -n "."
  sleep 0.5
done
echo ""

# ── UI or CLI ─────────────────────────────────────────────────
if [ "$MODE" = "cli" ]; then
  python3 cli.py
else
  if [ ! -d "$FRONTEND/node_modules" ]; then
    echo "  Installing frontend dependencies..."
    cd "$FRONTEND" && npm install && cd "$APP"
  fi

  echo "  Frontend → http://localhost:5173"
  echo "  Backend  → http://localhost:8000"
  echo "  Press Ctrl+C to stop everything."
  echo ""
  trap "echo ''; echo '  Stopping...'; kill $SERVER_PID 2>/dev/null; exit 0" INT
  cd "$FRONTEND" && npm run dev -- --open
fi

kill $SERVER_PID 2>/dev/null || true
