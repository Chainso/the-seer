# Seer Backend

FastAPI scaffold for Seer MVP.

## Local Development

1. `uv sync --extra dev`
2. `uv run uvicorn seer_backend.main:app --reload --host 0.0.0.0 --port 8000`

## Environment

Copy `.env.example` to `.env` and adjust values as needed.

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
