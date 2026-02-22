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

## Phase 4 Root-Cause Analysis APIs

1. `POST /api/v1/root-cause/run`
2. `GET /api/v1/root-cause/evidence`
3. `POST /api/v1/root-cause/assist/setup`
4. `POST /api/v1/root-cause/assist/interpret`

RCA requests require anchor + time window + bounded depth + outcome definition, and may include
optional cohort filters. Responses provide ranked insights (`WRAcc`, coverage, lift), plus
evidence handles for trace drill-down.
