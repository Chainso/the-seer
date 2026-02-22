#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

SESSION_NAME="${SEER_ZELLIJ_SESSION:-seer-local-dev}"

if ! command -v zellij >/dev/null 2>&1; then
  echo "zellij is required but not installed." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not installed." >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required but not installed." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not installed." >&2
  exit 1
fi

# If root .env exists, load it so DB credentials/ports mirror compose defaults.
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT_DIR}/.env"
  set +a
fi

export SEER_FUSEKI_HOST="${SEER_FUSEKI_HOST:-localhost}"
export SEER_FUSEKI_PORT="${SEER_FUSEKI_PORT:-3030}"
export SEER_FUSEKI_USERNAME="${SEER_FUSEKI_USERNAME:-admin}"
export SEER_FUSEKI_PASSWORD="${SEER_FUSEKI_PASSWORD:-${FUSEKI_ADMIN_PASSWORD:-admin}}"
export SEER_CLICKHOUSE_HOST="${SEER_CLICKHOUSE_HOST:-localhost}"
export SEER_CLICKHOUSE_PORT="${SEER_CLICKHOUSE_PORT:-${SEER_CLICKHOUSE_HTTP_PORT:-8123}}"
export SEER_CLICKHOUSE_DATABASE="${SEER_CLICKHOUSE_DATABASE:-${CLICKHOUSE_DB:-seer}}"
export SEER_CLICKHOUSE_USER="${SEER_CLICKHOUSE_USER:-${CLICKHOUSE_USER:-seer}}"
export SEER_CLICKHOUSE_PASSWORD="${SEER_CLICKHOUSE_PASSWORD:-${CLICKHOUSE_PASSWORD:-seer}}"
export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-http://localhost:8000}"

docker compose -f docker-compose.db.yml up -d

if zellij list-sessions --short 2>/dev/null | grep -Fxq "${SESSION_NAME}"; then
  exec zellij attach "${SESSION_NAME}"
fi

LAYOUT_FILE="$(mktemp /tmp/seer-zellij-layout.XXXXXX.kdl)"
cleanup() {
  rm -f "${LAYOUT_FILE}"
}
trap cleanup EXIT

cat > "${LAYOUT_FILE}" <<EOF
layout {
  default_tab_template {
    pane size=1 borderless=true {
      plugin location="tab-bar"
    }
    children
    pane size=1 borderless=true {
      plugin location="status-bar"
    }
  }
  tab name="seer-local-dev" {
    pane split_direction="Vertical" {
      pane split_direction="Horizontal" {
        pane name="backend" command="bash" cwd="${ROOT_DIR}/seer-backend" {
          args "-lc" "uv run uvicorn seer_backend.main:app --reload --host 0.0.0.0 --port 8000"
        }
        pane name="ui" command="bash" cwd="${ROOT_DIR}/seer-ui" {
          args "-lc" "npm run dev"
        }
      }
      pane split_direction="Horizontal" {
        pane name="fuseki-logs" command="bash" cwd="${ROOT_DIR}" {
          args "-lc" "docker compose -f docker-compose.db.yml logs -f fuseki"
        }
        pane name="clickhouse-logs" command="bash" cwd="${ROOT_DIR}" {
          args "-lc" "docker compose -f docker-compose.db.yml logs -f clickhouse"
        }
      }
    }
  }
}
EOF

if ! zellij setup --dump-layout "${LAYOUT_FILE}" >/dev/null; then
  echo "Generated zellij layout is invalid: ${LAYOUT_FILE}" >&2
  exit 1
fi

exec zellij -s "${SESSION_NAME}" -n "${LAYOUT_FILE}"
