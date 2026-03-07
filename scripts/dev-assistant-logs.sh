#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

LOG_PATH="${SEER_ASSISTANT_TURN_LOG_PATH:-${ROOT_DIR}/.local/logs/assistant-turns.jsonl}"
mkdir -p "$(dirname "${LOG_PATH}")"
touch "${LOG_PATH}"

tail -n 200 -F "${LOG_PATH}" | python3 scripts/render_assistant_turn_logs.py
