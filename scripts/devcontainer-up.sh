#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v devcontainer >/dev/null 2>&1; then
  echo "devcontainer CLI is required but not installed." >&2
  exit 1
fi

cd "${ROOT_DIR}"
devcontainer up --workspace-folder .
