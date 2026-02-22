# MVP Phase 0 Exec Plan: Foundation and Skeleton

**Status:** planned  
**Target order:** 0 of 6  
**Agent slot:** A1  
**Predecessor:** none  
**Successor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/active/mvp-phase-1-ontology-copilot-v1.md`

---

## Objective

Create a deterministic local development foundation for Seer: monorepo structure, runtime composition, and minimal backend/UI skeletons that future phases can build on.

## Scope

1. Create or confirm top-level directories: `docker/`, `seer-backend/`, `seer-ui/`, `docs/`.
2. Set up backend Python project skeleton with health endpoint and config loading.
3. Set up UI Next.js skeleton (created with `create-next-app`) with module route placeholders.
4. Create Docker Compose stack for backend, UI, Fuseki, ClickHouse.
5. Add local startup documentation and env templates.
6. Add baseline CI checks for backend and UI sanity.

## Non-Goals

1. No domain logic for ontology/event ingestion.
2. No production reliability hardening.
3. No tenant model implementation.

## Ambiguities Resolved

1. **Backend framework:** use `FastAPI` for MVP service boundary.
2. **Backend package/dependency management:** use `pyproject.toml` with `uv` as the default workflow.
3. **UI baseline:** use `create-next-app` with TypeScript + App Router.
4. **Local startup command:** `docker compose up --build` is the canonical bring-up path.
5. **CI baseline:** run fast checks only (lint/type/test smoke); defer full e2e until later phases.

## Implementation Steps

1. Create backend scaffold with:
   - app entrypoint,
   - health endpoint,
   - environment config model,
   - structured logging bootstrap.
2. Create Next.js app scaffold with route placeholders:
   - ontology explorer,
   - ingestion monitor,
   - process explorer,
   - root-cause lab,
   - insights dashboard.
3. Create `docker-compose.yml` and service configs for:
   - `seer-backend`,
   - `seer-ui`,
   - `fuseki`,
   - `clickhouse`.
4. Add `.env.example` files for backend/UI/runtime.
5. Add a startup script or documented command path for deterministic local boot.
6. Add minimal CI workflow covering backend and UI scaffold checks.
7. Update docs impacted by scaffold decisions.

## Acceptance Criteria

1. One command starts all required services locally.
2. Backend health endpoint is reachable through compose network.
3. UI route shell loads and can call backend health endpoint.
4. Backend can establish network-level reachability to Fuseki and ClickHouse.
5. Basic CI checks pass on repository changes.

## Handoff Package to Phase 1

1. Service startup and shutdown commands.
2. Finalized environment variable list with defaults.
3. Confirmed backend/UI base URLs and API prefix conventions.
4. Directory map for backend domains (`ontology`, `history`, `analytics`, `ai`, `api`).
5. Known constraints or TODOs that affect ontology ingestion implementation.

## Risks and Mitigations

1. **Risk:** compose drift across environments.  
   **Mitigation:** pin image tags and document exact versions.
2. **Risk:** early scaffold choices block later domain work.  
   **Mitigation:** keep skeleton thin and domain-oriented with clear extension points.
