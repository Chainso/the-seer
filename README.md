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

Helper scripts:

```bash
./scripts/dev-up.sh
./scripts/dev-down.sh
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
