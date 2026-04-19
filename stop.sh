#!/bin/bash

echo "  Stopping orches..."

pkill -f "uvicorn api.main:app" 2>/dev/null || true
pkill -f "python3 main.py"     2>/dev/null || true
lsof -ti:8000 | xargs kill -9  2>/dev/null || true
echo "  Backend stopped."
pkill -f "vite"                2>/dev/null && echo "  Frontend stopped." || true

echo "  Done."
# PostgreSQL is a system service — not stopped automatically.
# To stop manually: sudo service postgresql stop
