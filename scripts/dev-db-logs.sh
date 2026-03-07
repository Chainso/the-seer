#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <fuseki|clickhouse|postgres>" >&2
  exit 1
fi

case "$1" in
  fuseki|clickhouse|postgres) ;;
  *)
    echo "unsupported service: $1" >&2
    echo "expected one of: fuseki, clickhouse, postgres" >&2
    exit 1
    ;;
esac

exec docker compose -f docker-compose.db.yml logs -f "$1"
