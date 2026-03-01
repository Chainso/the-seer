# Seer Backend

FastAPI scaffold for Seer MVP.

## Local Development

1. `uv sync --extra dev`
2. `uv run uvicorn seer_backend.main:app --reload --host 0.0.0.0 --port 8000`

## Environment

Copy `.env.example` to `.env` and adjust values as needed.

## ClickHouse Client Approach

1. Runtime ClickHouse repositories use SQLAlchemy Core with the `clickhousedb` dialect as the canonical query/execution path.
2. Backend transport is centralized through the shared `clickhouse-connect` client utilities instead of per-repository HTTP wiring.
3. Direct repository `httpx` + `FORMAT JSON` transport/parsing paths are intentionally removed.
4. ClickHouse engine options are wired from `SEER_CLICKHOUSE_*` settings, including DSN options (`SEER_CLICKHOUSE_COMPRESSION`, `SEER_CLICKHOUSE_QUERY_LIMIT`) and timeout options (`SEER_CLICKHOUSE_TIMEOUT_SECONDS`, `SEER_CLICKHOUSE_CONNECT_TIMEOUT_SECONDS`, `SEER_CLICKHOUSE_SEND_RECEIVE_TIMEOUT_SECONDS`).
5. Runtime limitations are explicit:
   - no `UPDATE` expectation in repository paths,
   - no transaction guarantees from SQLAlchemy `begin/commit/rollback`,
   - no reliance on `RETURNING` or sequence/autoincrement semantics.

## Phase 2 History APIs

1. `POST /api/v1/history/events/ingest`
2. `GET /api/v1/history/events`
3. `GET /api/v1/history/objects/timeline`
4. `GET /api/v1/history/relations`

ClickHouse history tables are defined in `migrations/clickhouse/001_mvp_phase2_history_tables.sql`
and are applied lazily on first history API usage.

## Phase 3 Process Mining APIs

1. `POST /api/v1/process/mine`
2. `GET /api/v1/process/traces`

Mining requests require `anchor_object_type`, `start_at`, and `end_at`.
Responses include the UI payload fields (`nodes`, `edges`, `object_types`, `path_stats`)
plus trace drill-down handles for model elements.

## Phase 4 Root-Cause Analysis APIs

1. `POST /api/v1/root-cause/run`
2. `GET /api/v1/root-cause/evidence`
3. `POST /api/v1/root-cause/assist/setup`
4. `POST /api/v1/root-cause/assist/interpret`

RCA requests require anchor + time window + bounded depth + outcome definition, and may include
optional cohort filters. Responses provide ranked insights (`WRAcc`, coverage, lift), plus
evidence handles for trace drill-down.
