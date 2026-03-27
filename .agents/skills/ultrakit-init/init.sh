#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCAFFOLD_DIR="$SCRIPT_DIR/scaffold"
TARGET_DIR=".ultrakit"

if [ -d "$TARGET_DIR" ]; then
  echo "ultrakit is already initialized (.ultrakit/ exists)."
  exit 0
fi

cp -r "$SCAFFOLD_DIR" "$TARGET_DIR"
echo "ultrakit initialized. Created .ultrakit/ with:"
find "$TARGET_DIR" -type f | sort | sed 's/^/  /'
