# Seer Monorepo

Seer is an AI-native operating intelligence platform.

## MVP Foundation (Phase 0)

This repository provides a deterministic local runtime for:

1. `seer-backend` (FastAPI)
2. `seer-ui` (Next.js)
3. Fuseki
4. ClickHouse

## Agent Workflow

For agent-driven delivery, use the `plan-and-execute` skill from `.agent/skills/plan-and-execute/SKILL.md` whenever work should be planned and then executed end-to-end.

Execution plans remain canonical in `docs/exec-plans/active/` and must be updated during implementation.

## Devcontainer

`.devcontainer/` provides an isolated in-container development workspace for this monorepo.

What it sets up:

1. A named Docker volume mounted at `/workspaces/seer-python` for the container-side repo copy.
2. Your host checkout mounted read-only at `/mnt/host-workspace`, used only to seed the isolated workspace on first create.
3. Codex installed in the container, with `codex` defaulting to full access (`--dangerously-bypass-approvals-and-sandbox`).
4. A container-local named volume mounted at `/root/.codex`, with host `~/.codex` mounted separately as read-only at `/mnt/host-codex`.
5. Host `~/.codex`, `~/.gitconfig`, and `~/.ssh` seeded into container-local config during bootstrap/startup so Codex auth and git push work without giving the container host write access to those paths.
6. A Docker daemon running inside the devcontainer, so `docker compose` stays container-local rather than controlling the host Docker daemon.

On first create, the workspace volume is populated with a real local `git clone` of the host repo, so `/workspaces/seer-python` has its own `.git` directory and independent history state.

That means the container does not write back to the host checkout or host credential/config directories during normal operation. The host checkout, Codex config, git config, and SSH directory remain read-only mounts, and the container writes only to its own named volumes unless you explicitly copy data out.

First bootstrap happens automatically through the devcontainer post-create hook:

```bash
/usr/local/share/devcontainer/bootstrap-workspace.sh
```

Host-side helper scripts:

```bash
./scripts/devcontainer-up.sh
./scripts/devcontainer-shell.sh
./scripts/devcontainer-sync-from-host.sh
```

Use them to:

1. build/start the devcontainer,
2. jump into an interactive shell in the isolated workspace,
3. resync host checkout changes into the isolated workspace when you want to refresh it.

Once the devcontainer is open, the normal inner-loop command is still:

```bash
./scripts/dev-local-zellij.sh
```

That keeps the current zellij layout, starts DB services through `docker-compose.db.yml` inside the devcontainer Docker daemon, runs backend + UI inside the devcontainer workspace volume, and leaves the existing ingest/load helper scripts usable against `http://localhost:8000`.

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

Inside the devcontainer, the same workflow stays supported without a second script.
Because Docker also runs inside the devcontainer, the existing `localhost` defaults
continue to work for backend-to-DB connections.

Single-command launch with zellij multiplexing:

```bash
./scripts/dev-local-zellij.sh
```

This starts Fuseki + ClickHouse in Docker, then opens a `zellij` session with panes
for backend, UI, DB logs, and a dedicated assistant turn log stream.

By default, rerunning the script recreates that zellij session so pane commands and
layout changes are applied immediately rather than reattaching to stale panes.

The assistant pane tails:

```bash
.local/logs/assistant-turns.jsonl
```

The backend writes that file when `SEER_ASSISTANT_TURN_LOG_PATH` is set. The
zellij helper sets it automatically by default for local development.

By default, when that zellij session is fully quit (not just detached), the script
automatically runs:

```bash
docker compose -f docker-compose.db.yml down
```

Optional session name override:

```bash
SEER_ZELLIJ_SESSION=seer-dev ./scripts/dev-local-zellij.sh
```

Reattach to an existing session instead of recreating it:

```bash
SEER_ZELLIJ_RECREATE_SESSION=0 ./scripts/dev-local-zellij.sh
```

Disable auto DB shutdown on zellij exit:

```bash
SEER_AUTO_DB_DOWN_ON_EXIT=0 ./scripts/dev-local-zellij.sh
```

Override the assistant turn log file path:

```bash
SEER_ASSISTANT_TURN_LOG_PATH=/tmp/seer-assistant-turns.jsonl ./scripts/dev-local-zellij.sh
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

1. `SEER_OPENAI_BASE_URL=https://opencode.ai/zen/v1/chat/completions`
2. `SEER_OPENAI_MODEL=big-pickle`
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
