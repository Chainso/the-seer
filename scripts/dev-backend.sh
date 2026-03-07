#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}/seer-backend"

exec uv run uvicorn seer_backend.main:app --reload --host 0.0.0.0 --port 8000
