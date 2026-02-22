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
