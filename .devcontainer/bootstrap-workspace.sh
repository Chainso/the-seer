#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="/mnt/host-workspace"
TARGET_DIR="/workspaces/seer-python"
SEED_MARKER="${TARGET_DIR}/.devcontainer-seeded"
SYNC_SCRIPT="/usr/local/share/devcontainer/sync-from-host.sh"
HOST_CONFIG_SYNC_SCRIPT="/usr/local/share/devcontainer/sync-host-config.sh"
TMP_CLONE_ROOT=""

cleanup() {
  if [ -n "${TMP_CLONE_ROOT}" ] && [ -d "${TMP_CLONE_ROOT}" ]; then
    rm -rf "${TMP_CLONE_ROOT}"
  fi
}

trap cleanup EXIT

if [ ! -d "${SOURCE_DIR}" ]; then
  echo "Missing source directory: ${SOURCE_DIR}" >&2
  exit 1
fi

if [ ! -x "${SYNC_SCRIPT}" ]; then
  echo "Missing sync script: ${SYNC_SCRIPT}" >&2
  exit 1
fi

if [ ! -x "${HOST_CONFIG_SYNC_SCRIPT}" ]; then
  echo "Missing host config sync script: ${HOST_CONFIG_SYNC_SCRIPT}" >&2
  exit 1
fi

mkdir -p "${TARGET_DIR}"

"${HOST_CONFIG_SYNC_SCRIPT}"

git config --global --add safe.directory "${SOURCE_DIR}" || true
git config --global --add safe.directory "${SOURCE_DIR}/.git" || true

if [ ! -d "${TARGET_DIR}/.git" ]; then
  echo "Seeding isolated workspace volume with a local git clone..."
  TMP_CLONE_ROOT="$(mktemp -d /tmp/seer-python-clone.XXXXXX)"
  git clone --no-hardlinks "${SOURCE_DIR}" "${TMP_CLONE_ROOT}/repo"
  find "${TARGET_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  shopt -s dotglob nullglob
  mv "${TMP_CLONE_ROOT}/repo"/* "${TARGET_DIR}/"
  shopt -u dotglob nullglob
  touch "${SEED_MARKER}"
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
