#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON_BIN="${PYTHON_BIN:-python3}"
"$PYTHON_BIN" -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
npm run build
printf '\nReady. Run npm start, then open http://localhost:3000\n'
