#!/usr/bin/env bash
set -euo pipefail

HOST_CODEX_DIR="/mnt/host-codex"
CONTAINER_CODEX_DIR="/root/.codex"
HOST_GITCONFIG="/mnt/host-gitconfig"
HOST_SSH_DIR="/mnt/host-ssh"
CONTAINER_SSH_DIR="/root/.ssh"

if [ -f "${HOST_GITCONFIG}" ]; then
  cp "${HOST_GITCONFIG}" /root/.gitconfig
  chmod 600 /root/.gitconfig
fi

if [ -d "${HOST_CODEX_DIR}" ]; then
  mkdir -p "${CONTAINER_CODEX_DIR}"
  chmod 700 "${CONTAINER_CODEX_DIR}"
  # Seed host Codex state into container-local storage without ever writing back to the host bind mount.
  rsync -a --no-owner --no-group "${HOST_CODEX_DIR}/" "${CONTAINER_CODEX_DIR}/"
fi

if [ -d "${HOST_SSH_DIR}" ]; then
  mkdir -p "${CONTAINER_SSH_DIR}"
  rsync -a "${HOST_SSH_DIR}/" "${CONTAINER_SSH_DIR}/"
  chown -R root:root "${CONTAINER_SSH_DIR}"
  chmod 700 "${CONTAINER_SSH_DIR}"
  find "${CONTAINER_SSH_DIR}" -type f -name "*.pub" -exec chmod 644 {} +
  find "${CONTAINER_SSH_DIR}" -type f ! -name "*.pub" -exec chmod 600 {} +
fi
