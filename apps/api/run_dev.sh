#!/usr/bin/env bash
# Convenience launcher for the gaze-prediction FastAPI backend.
#
# Usage:
#   ./apps/api/run_dev.sh                # uses python from PATH
#   PYTHON=/opt/anaconda3/envs/hacktech26/bin/python ./apps/api/run_dev.sh
#
# Environment variables:
#   GAZE_CHECKPOINT   path to .pt file (default: model/checkpoints/gaze_epoch250.pt)
#   MODEL_DEVICE      auto | cpu | cuda | mps  (default: auto)
#   API_HOST          bind host (default: 127.0.0.1)
#   API_PORT          bind port (default: 8000)
#   ALLOWED_ORIGINS   comma-separated CORS origins (default: localhost:3000)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

PYTHON_BIN="${PYTHON:-python3}"
HOST="${API_HOST:-127.0.0.1}"
PORT="${API_PORT:-8000}"

echo "[gaze-api] repo:      $REPO_ROOT"
echo "[gaze-api] python:    $PYTHON_BIN ($($PYTHON_BIN --version 2>&1))"
echo "[gaze-api] checkpoint:${GAZE_CHECKPOINT:-model/checkpoints/gaze_epoch250.pt}"
echo "[gaze-api] device:    ${MODEL_DEVICE:-auto}"
echo "[gaze-api] listening: http://$HOST:$PORT"

exec "$PYTHON_BIN" -m uvicorn apps.api.main:app \
    --host "$HOST" \
    --port "$PORT" \
    --reload
