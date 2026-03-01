#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

SESSION_NAME="${SEER_ZELLIJ_SESSION:-seer-local-dev}"
AUTO_DB_DOWN_ON_EXIT="${SEER_AUTO_DB_DOWN_ON_EXIT:-1}"

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

case "${AUTO_DB_DOWN_ON_EXIT,,}" in
  1|true|yes|y) AUTO_DB_DOWN_ON_EXIT="true" ;;
  0|false|no|n) AUTO_DB_DOWN_ON_EXIT="false" ;;
  *)
    echo "SEER_AUTO_DB_DOWN_ON_EXIT must be one of: 1,true,yes,y,0,false,no,n" >&2
    exit 1
    ;;
esac

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
export SEER_ACTIONS_DB_DSN="${SEER_ACTIONS_DB_DSN:-postgresql+psycopg://${SEER_ACTIONS_POSTGRES_USER:-seer}:${SEER_ACTIONS_POSTGRES_PASSWORD:-seer}@localhost:${SEER_ACTIONS_DB_PORT:-5432}/${SEER_ACTIONS_POSTGRES_DB:-seer_actions}}"
export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-http://localhost:8000}"

docker compose -f docker-compose.db.yml up -d

if zellij list-sessions --short 2>/dev/null | grep -Fxq "${SESSION_NAME}"; then
  if zellij attach "${SESSION_NAME}"; then
    ZELLIJ_EXIT_STATUS=0
  else
    ZELLIJ_EXIT_STATUS=$?
  fi
else
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
        pane split_direction="Vertical" {
          pane name="clickhouse-logs" command="bash" cwd="${ROOT_DIR}" {
            args "-lc" "docker compose -f docker-compose.db.yml logs -f clickhouse"
          }
          pane name="postgres-logs" command="bash" cwd="${ROOT_DIR}" {
            args "-lc" "docker compose -f docker-compose.db.yml logs -f postgres"
          }
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

  if zellij -s "${SESSION_NAME}" -n "${LAYOUT_FILE}"; then
    ZELLIJ_EXIT_STATUS=0
  else
    ZELLIJ_EXIT_STATUS=$?
  fi
fi

if [[ "${AUTO_DB_DOWN_ON_EXIT}" == "true" ]]; then
  if ! zellij list-sessions --short 2>/dev/null | grep -Fxq "${SESSION_NAME}"; then
    docker compose -f docker-compose.db.yml down
  fi
fi

exit "${ZELLIJ_EXIT_STATUS}"
