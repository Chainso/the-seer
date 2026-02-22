#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ "${SEER_USE_HOST_GEMINI:-0}" == "1" ]]; then
  docker compose -f docker-compose.yml -f docker-compose.gemini-host.yml up --build
else
  docker compose up --build
fi
