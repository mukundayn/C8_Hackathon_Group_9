#!/usr/bin/env bash
# build.sh — Production build for Render (single-service deploy).
# Compiles the React frontend and places dist/ inside backend/static/
# so FastAPI serves both the API and the static UI from one process.
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$ROOT/frontend"
BACKEND="$ROOT/backend"

echo "▶ Installing frontend dependencies…"
cd "$FRONTEND"
npm install

echo "▶ Building React app…"
npm run build

echo "▶ Copying dist → backend/static…"
rm -rf "$BACKEND/static"
cp -r "$FRONTEND/dist" "$BACKEND/static"

echo "✅ Build complete. Start with:"
echo "   cd backend && uvicorn app.main:app --host 0.0.0.0 --port \$PORT"
