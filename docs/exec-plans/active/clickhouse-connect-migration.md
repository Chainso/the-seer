# Post-MVP Exec Plan: Migrate Backend ClickHouse Access to clickhouse-connect

**Status:** in_progress  
**Track:** post-MVP backend data-plane hardening  
**Predecessor:** none  
**Successor:** `docs/exec-plans/active/ocdfg-pm4py-backend-ui-first-diagram.md`  
**Last updated:** 2026-03-01

---

## Objective

Replace direct raw HTTP ClickHouse access (`httpx` + `FORMAT JSON`/`JSONEachRow`) with `clickhouse-connect`-based repository access across history, process mining, and root-cause paths.

## Delivery Stance

1. Forward-only migration: do not preserve legacy repository transport behavior by default.
2. If optimal architecture requires contract or behavior changes, make them directly and update docs/specs in the same change.
3. Legacy compatibility concessions must be explicitly justified in the decision log; default is no concession.

## Why This Plan Exists

Current repositories handcraft SQL transport and response parsing at multiple call sites. This creates duplicated transport logic, weak typing around query results, and blocks planned Arrow/Polars data workflows needed by upcoming OC-DFG work.

## Scope

1. Add `clickhouse-connect` as the canonical ClickHouse client for backend repositories.
2. Introduce a shared ClickHouse client abstraction used by:
   - history repository,
   - process mining repository,
   - root-cause repository.
3. Optimize backend contracts and semantics for the target architecture, even when legacy behavior must break.
4. Enable typed query helpers for row results and dataframe/arrow retrieval paths.
5. Evaluate `clickhouse-connect` SQLAlchemy dialect usage and define allowed usage boundaries for Seer.
6. Update tests and docs to reflect the new client stack.

## Non-Goals

1. Changing product-facing API contracts.
2. Reworking ontology/Fuseki repository transport.
3. Full analytics-model redesign (handled in follow-up plans).
4. Forcing ORM-style modeling where ClickHouse dialect limitations make it a poor fit.

## Invariants

1. ClickHouse behavior after migration is deterministic, documented, and internally consistent across history/process/RCA APIs.
2. ClickHouse credential/config source remains `SEER_CLICKHOUSE_*` settings.
3. Guardrails and validation behavior (`413`, `422`, `404`, etc.) must not regress.
4. Migration SQL application remains supported.

## Legacy Behavior Removal (Intentional)

1. Remove direct per-repository HTTP POST transport code for ClickHouse.
2. Remove duplicated JSON response parsing boilerplate in repositories.
3. Standardize on one client path instead of mixed ad hoc transport patterns.

## SQLAlchemy Exploration Goal

1. Determine whether the `clickhousedb` SQLAlchemy dialect should be adopted for:
   - selective query construction/reflection utilities, or
   - no production path (driver-only path only).
2. Produce a written decision with rationale based on dialect scope/limitations and Seer async repository architecture.

## Phase Map

## Phase 1: Baseline and Client Design

### Scope

1. Record baseline behavior and tests for history/process/RCA repository paths.
2. Add a shared `clickhouse-connect` client module with:
   - query execution,
   - command execution,
   - insert helpers,
   - consistent exception translation.

### Exit Criteria

1. Shared client abstraction exists and is used by at least one repository path.
2. Error mapping strategy is documented in plan decision log.

### Validation

1. `cd seer-backend && uv run ruff check src/seer_backend`
2. `cd seer-backend && uv run pytest -q tests/test_history_phase2.py`

## Phase 2: History Repository Migration

### Scope

1. Port `ClickHouseHistoryRepository` read/write paths to shared `clickhouse-connect` client.
2. Preserve JSON payload semantics for stored object/event data.
3. Keep migration-apply behavior functional.

### Exit Criteria

1. History ingest + query tests pass without HTTP transport code in history repository.

### Validation

1. `cd seer-backend && uv run pytest -q tests/test_history_phase2.py`
2. `cd seer-backend && uv run pytest -q tests/test_history_query_api.py`

## Phase 3: Process + RCA Repository Migration

### Scope

1. Port `ClickHouseProcessMiningRepository` to shared client.
2. Port `ClickHouseRootCauseRepository` to shared client.
3. Preserve current extraction ordering and deterministic output expectations.

### Exit Criteria

1. Process and RCA contract tests pass on migrated repositories.
2. No direct `httpx.AsyncClient` ClickHouse transport remains in migrated repositories.

### Validation

1. `cd seer-backend && uv run pytest -q tests/test_process_phase3.py`
2. `cd seer-backend && uv run pytest -q tests/test_root_cause_phase4.py`

## Phase 4: Regression Hardening + Docs

### Scope

1. Run backend full-suite regression.
2. Update backend README and architecture/plans index references.
3. Document migration completion and unblock dependent OC-DFG plan.

### Exit Criteria

1. Backend regression checks pass or unrelated baseline failures are explicitly logged.
2. Active plan statuses are updated consistently.

### Validation

1. `cd seer-backend && uv run pytest -q`
2. `cd seer-backend && uv run ruff check src tests`

## Phase 5: SQLAlchemy Dialect Spike and Decision

### Scope

1. Build a minimal spike using `clickhousedb://` with SQLAlchemy Core on a non-critical path.
2. Validate practical fit for Seer repository patterns:
   - Core `SELECT`/JOIN composition,
   - insert ergonomics,
   - async compatibility constraints.
3. Record explicit allow/deny policy for production usage:
   - allowed for targeted tooling/query composition, or
   - restricted to non-production helper use.

### Exit Criteria

1. Decision log includes a clear recommendation and constraints.
2. Plan/docs capture whether SQLAlchemy is:
   - adopted for limited use, or
   - intentionally excluded from runtime repositories.

### Validation

1. `cd seer-backend && uv run pytest -q tests/test_process_phase3.py tests/test_root_cause_phase4.py`
2. `cd seer-backend && uv run ruff check src/seer_backend`

## Risks and Mitigations

1. **Risk:** behavioral drift in datetime/UUID parsing when switching client result formats.  
   **Mitigation:** retain existing model conversion helpers and add focused parsing tests.
2. **Risk:** insert path regressions for JSON payload columns.  
   **Mitigation:** preserve current JSON serialization shape and add ingestion regression checks.
3. **Risk:** mixed client usage lingers after migration.  
   **Mitigation:** explicit grep gate in phase close checklist to remove legacy transport code.
4. **Risk:** SQLAlchemy dialect overreach introduces unsupported ORM/transaction expectations.  
   **Mitigation:** constrain evaluation to documented dialect capabilities and record strict usage boundaries.

## Plan/Doc Updates Required

1. Update this plan during each phase with progress notes and decisions.
2. Update `docs/exec-plans/active/index.md` current state as phases complete.
3. Update `seer-backend/README.md` to describe ClickHouse client approach.
4. If data-plane architectural wording changes materially, update `ARCHITECTURE.md`.

## Progress Checklist

- [x] Phase 1 complete
- [x] Phase 2 complete
- [ ] Phase 3 complete
- [ ] Phase 4 complete
- [ ] Phase 5 complete

## Decision Log

1. 2026-03-01: Created dedicated migration plan to decouple transport modernization from OC-DFG feature delivery and reduce execution risk.
2. 2026-03-01: Added explicit SQLAlchemy dialect spike phase to evaluate `clickhousedb` integration with documented scope limits before adoption.
3. 2026-03-01: Shared client now raises explicit transport exceptions (`ClickHouseQueryExecutionError`, `ClickHouseCommandExecutionError`); repositories map these to module domain errors (`HistoryError` now, Process/RCA in later phases).
4. 2026-03-01: Phase 2 migrated `ClickHouseHistoryRepository` read/write execution to `AsyncClickHouseClient`, removed direct `httpx` transport helpers, and kept repository-level `HistoryError` mapping stable for query/statement failure paths.
