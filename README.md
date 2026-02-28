# Seer Monorepo

Seer is an AI-native operating intelligence platform.

## MVP Foundation (Phase 0)

This repository provides a deterministic local runtime for:

1. `seer-backend` (FastAPI)
2. `seer-ui` (Next.js)
3. Fuseki
4. ClickHouse

## Startup

Optional runtime overrides:

```bash
cp .env.example .env
```

Canonical command:

```bash
docker compose up --build
```

The backend compose service now mounts `./prophet` to `/prophet` and uses
`SEER_PROPHET_METAMODEL_PATH=/prophet/prophet.ttl`, so ontology ingest works
without manual container patching.
Compose also provisions Fuseki dataset `/ds` and wires backend Fuseki credentials
automatically.

Helper scripts:

```bash
./scripts/dev-up.sh
./scripts/dev-down.sh
```

## Test Data Scripts

Use these scripts when Seer backend is already running:

1. Ingest the complex Prophet Turtle example:

```bash
python3 scripts/ingest_complex_turtle.py
```

2. Generate fake history events JSON (with synthetic timestamps):

```bash
python3 scripts/generate_fake_event_data.py --output /tmp/seer-fake-events.json --count 500
```

3. Ingest one generated JSON file into history event ingestion:

```bash
python3 scripts/ingest_history_events.py --input /tmp/seer-fake-events.json
```

4. Verify RCA returns high-signal results on fake data:

```bash
python3 scripts/verify_fake_data_rca.py --input fake-data.json --ingest
```

All scripts accept `--api-base-url` and `--api-prefix` when your backend is not using
`http://localhost:8000/api/v1`.

## DB-Only Docker (Local Backend + UI)

Use the DB-only compose file when you want to run `seer-backend` and `seer-ui` on
your host machine, while keeping only data services in Docker.

Single-command launch with zellij multiplexing:

```bash
./scripts/dev-local-zellij.sh
```

This starts Fuseki + ClickHouse in Docker, then opens a `zellij` session with panes
for backend, UI, and DB logs.

By default, when that zellij session is fully quit (not just detached), the script
automatically runs:

```bash
docker compose -f docker-compose.db.yml down
```

Optional session name override:

```bash
SEER_ZELLIJ_SESSION=seer-dev ./scripts/dev-local-zellij.sh
```

Disable auto DB shutdown on zellij exit:

```bash
SEER_AUTO_DB_DOWN_ON_EXIT=0 ./scripts/dev-local-zellij.sh
```

When finished:

```bash
./scripts/dev-db-down.sh
```

Manual DB-only startup remains available:

```bash
docker compose -f docker-compose.db.yml up -d
```

Or with helper scripts:

```bash
./scripts/dev-db-up.sh
./scripts/dev-db-down.sh
```

For host-run backend, set these values in `seer-backend/.env`:

```bash
SEER_FUSEKI_HOST=localhost
SEER_FUSEKI_PORT=3030
SEER_FUSEKI_USERNAME=admin
SEER_FUSEKI_PASSWORD=admin
SEER_CLICKHOUSE_HOST=localhost
SEER_CLICKHOUSE_PORT=8123
SEER_CLICKHOUSE_DATABASE=seer
SEER_CLICKHOUSE_USER=seer
SEER_CLICKHOUSE_PASSWORD=seer
```

Then start apps locally from their directories:

```bash
cd seer-backend && uv sync --extra dev && uv run uvicorn seer_backend.main:app --reload --host 0.0.0.0 --port 8000
cd seer-ui && npm ci && npm run dev
```

## OpenAI Endpoint In Docker

`seer-backend` now uses an OpenAI-compatible Chat Completions endpoint for ontology copilot runtime.

Defaults:

1. `SEER_OPENAI_BASE_URL=http://host.docker.internal:8787/v1`
2. `SEER_OPENAI_MODEL=gemini-3-flash-preview`
3. `SEER_OPENAI_API_KEY=` (empty is acceptable for local endpoints that ignore API keys)

If your endpoint differs, override these values in `.env`.

Then start normally:

```bash
docker compose up --build
```

## Service Endpoints

1. UI: `http://localhost:3000`
2. Backend health: `http://localhost:8000/api/v1/health`
3. Fuseki: `http://localhost:3030`
4. ClickHouse HTTP: `http://localhost:8123`

## Environment Templates

1. Runtime defaults: `.env.example`
2. Backend service config: `seer-backend/.env.example`
3. UI service config: `seer-ui/.env.example`
