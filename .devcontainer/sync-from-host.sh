#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="/tmp/host-workspace"
TARGET_DIR="/workspaces/seer-python"
DELETE_MODE=1
DRY_RUN=0
EXCLUDES=()

usage() {
  cat <<'EOF'
Usage: sync-from-host.sh [options]

Syncs files from /tmp/host-workspace into /workspaces/seer-python.

Options:
  --exclude <path>   Exclude a path pattern from sync (can be used multiple times)
  --no-delete        Do not remove files from target that were removed from source
  --dry-run          Show what would change without writing changes
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --exclude)
      shift
      if [ "$#" -eq 0 ]; then
        echo "Missing value for --exclude" >&2
        usage
        exit 1
      fi
      EXCLUDES+=("$1")
      ;;
    --no-delete)
      DELETE_MODE=0
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

if [ ! -d "${SOURCE_DIR}" ]; then
  echo "Missing source directory: ${SOURCE_DIR}" >&2
  exit 1
fi

mkdir -p "${TARGET_DIR}"

CMD=(rsync -a)
if [ "${DELETE_MODE}" -eq 1 ]; then
  CMD+=(--delete)
fi
if [ "${DRY_RUN}" -eq 1 ]; then
  CMD+=(--dry-run --itemize-changes)
fi

CMD+=(--exclude ".devcontainer-seeded")
for pattern in "${EXCLUDES[@]}"; do
  CMD+=(--exclude "${pattern}")
done

CMD+=("${SOURCE_DIR}/" "${TARGET_DIR}/")

echo "Running sync from ${SOURCE_DIR} to ${TARGET_DIR}"
if [ "${#EXCLUDES[@]}" -gt 0 ]; then
  echo "Excluding: ${EXCLUDES[*]}"
fi

"${CMD[@]}"
