#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="/mnt/host-workspace"
TARGET_DIR="/workspaces/seer-python"
SEED_MARKER="${TARGET_DIR}/.devcontainer-seeded"
SYNC_SCRIPT="/usr/local/share/devcontainer/sync-from-host.sh"

if [ ! -d "${SOURCE_DIR}" ]; then
  echo "Missing source directory: ${SOURCE_DIR}" >&2
  exit 1
fi

if [ ! -x "${SYNC_SCRIPT}" ]; then
  echo "Missing sync script: ${SYNC_SCRIPT}" >&2
  exit 1
fi

if [ ! -e "${SEED_MARKER}" ]; then
  echo "Seeding isolated workspace volume from host copy..."
  "${SYNC_SCRIPT}" \
    --no-delete \
    --exclude ".next" \
    --exclude "node_modules" \
    --exclude ".ruff_cache" \
    --exclude ".pytest_cache" \
    --exclude ".uv-cache" \
    --exclude "__pycache__" \
    --exclude "seer-backend/.venv" \
    --exclude "seer-backend/dist"
  touch "${SEED_MARKER}"
fi

if [ -f /mnt/host-gitconfig ]; then
  cp /mnt/host-gitconfig /root/.gitconfig
fi

if [ -d /mnt/host-ssh ]; then
  mkdir -p /root/.ssh
  rsync -a /mnt/host-ssh/ /root/.ssh/
  chmod 700 /root/.ssh
  find /root/.ssh -type f -name "*.pub" -exec chmod 644 {} +
  find /root/.ssh -type f ! -name "*.pub" -exec chmod 600 {} +
fi

git config --global --add safe.directory "${TARGET_DIR}" || true

if [ -f "${TARGET_DIR}/seer-ui/package-lock.json" ]; then
  cd "${TARGET_DIR}/seer-ui"
  npm ci
fi

if [ -f "${TARGET_DIR}/seer-backend/pyproject.toml" ]; then
  cd "${TARGET_DIR}/seer-backend"
  uv sync --extra dev
fi
