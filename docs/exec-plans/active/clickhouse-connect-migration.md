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
4. Intermediate-phase breakage is acceptable while migrating; only phase exit gates determine acceptability.

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
5. Adopt SQLAlchemy integration (`clickhousedb` dialect) in all production ClickHouse repository code, not only as a spike.
6. Make SQLAlchemy Core the default query/execution path for all ClickHouse repositories.
7. Update tests and docs to reflect the new client stack.

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

## SQLAlchemy Adoption Goal

1. Use the `clickhousedb` SQLAlchemy dialect in all runtime ClickHouse repository code for query construction and execution.
2. Keep forward-only scope: if adopting SQLAlchemy changes query shape or behavior, update tests/contracts/docs rather than preserving legacy quirks.
3. Record explicit boundaries for unsupported ORM/transaction semantics.

## SQLAlchemy Dialect Utilization Model

1. Engine/DSN standard:
   - use `clickhousedb://` or `clickhousedb+connect://`,
   - expose DSN query parameters for ClickHouse settings and client options (`compression`, timeout options, query limit).
2. Core-first query model (required):
   - `SELECT` with joins/filters/order/limit/offset/distinct via SQLAlchemy Core statements,
   - lightweight `DELETE` only with explicit `WHERE`,
   - Core `INSERT` where practical for repository write paths.
3. DDL/reflection usage:
   - use dialect DDL helpers and reflection where schema introspection reduces hard-coded table metadata,
   - do not introduce ORM relationship features as runtime dependencies.
4. ClickHouse-aware limitations (must be encoded in docs/code comments):
   - no `UPDATE` support expectation,
   - no transaction guarantees (`begin/commit/rollback` semantics are not DB transactions),
   - no reliance on `RETURNING`, advanced isolation, or sequence semantics,
   - SQLAlchemy `primary_key=True` is identity metadata, not a server-enforced constraint.

## Reference

1. SQLAlchemy dialect reference source: `https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/refs/heads/main/docs/integrations/language-clients/python/sqlalchemy.md`

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

## Phase 4: SQLAlchemy Integration in Runtime Repositories

### Scope

1. Add `sqlalchemy` dependency and wire a shared ClickHouse SQLAlchemy utility module.
2. Integrate SQLAlchemy Core + `clickhousedb` dialect into all production repository code:
   - history repository read/write query paths,
   - process mining repository extraction/query paths,
   - root-cause repository extraction/query paths.
3. Remove optional transport branches in runtime repository code so SQLAlchemy-backed execution is the single production path.
4. Encode non-supported semantics (transactions/ORM assumptions) as guardrail documentation in code/docs.

### Exit Criteria

1. SQLAlchemy is used across all runtime ClickHouse repository paths (not only a spike file/test).
2. Query behavior remains deterministic and tests pass.
3. Integration boundaries are documented.

### Validation

1. `cd seer-backend && uv run ruff check src/seer_backend`
2. `cd seer-backend && uv run pytest -q tests/test_process_phase3.py tests/test_root_cause_phase4.py`

## Phase 5: Regression Hardening + Docs

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

## Phase 6: Independent Compliance Audit (Subagent Review)

### Scope

1. Spawn an independent review agent to audit current ClickHouse + SQLAlchemy usage across all runtime repositories.
2. Verify implementation alignment with this plan's SQLAlchemy utilization model:
   - DSN/engine usage,
   - Core query coverage (`SELECT`/joins/order/limit/distinct),
   - insert/delete semantics,
   - documented limitations (no transaction guarantees, no update expectation, etc.).
3. Produce a gap report with required fixes (if any), prioritized by correctness risk.
4. Apply required remediations and re-run targeted validation for touched paths.

### Exit Criteria

1. Independent audit report confirms compliance, or all identified gaps are fixed and verified.
2. Decision log records the audit outcome and any remediation decisions.
3. Plan can be marked `completed` only after this phase closes.

### Validation

1. `cd seer-backend && uv run pytest -q tests/test_history_phase2.py tests/test_process_phase3.py tests/test_root_cause_phase4.py`
2. `cd seer-backend && uv run ruff check src/seer_backend`

## Risks and Mitigations

1. **Risk:** behavioral drift in datetime/UUID parsing when switching client result formats.  
   **Mitigation:** retain existing model conversion helpers and add focused parsing tests.
2. **Risk:** insert path regressions for JSON payload columns.  
   **Mitigation:** preserve current JSON serialization shape and add ingestion regression checks.
3. **Risk:** mixed client usage lingers after migration.  
   **Mitigation:** explicit grep gate in phase close checklist to remove legacy transport code.
4. **Risk:** SQLAlchemy dialect overreach introduces unsupported ORM/transaction expectations.  
   **Mitigation:** restrict to SQLAlchemy Core patterns and document explicit non-goals for ORM/transaction semantics.

## Plan/Doc Updates Required

1. Update this plan during each phase with progress notes and decisions.
2. Update `docs/exec-plans/active/index.md` current state as phases complete.
3. Update `seer-backend/README.md` to describe ClickHouse client approach.
4. If data-plane architectural wording changes materially, update `ARCHITECTURE.md`.

## Progress Checklist

- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete
- [x] Phase 4 complete
- [x] Phase 5 complete
- [x] Phase 6 complete

## Decision Log

1. 2026-03-01: Created dedicated migration plan to decouple transport modernization from OC-DFG feature delivery and reduce execution risk.
2. 2026-03-01: Initial SQLAlchemy work was scoped as a spike, then upgraded to mandatory runtime integration per execution replan.
3. 2026-03-01: Shared client now raises explicit transport exceptions (`ClickHouseQueryExecutionError`, `ClickHouseCommandExecutionError`); repositories map these to module domain errors (`HistoryError` now, Process/RCA in later phases).
4. 2026-03-01: Phase 2 migrated `ClickHouseHistoryRepository` read/write execution to `AsyncClickHouseClient`, removed direct `httpx` transport helpers, and kept repository-level `HistoryError` mapping stable for query/statement failure paths.
5. 2026-03-01: Phase 3 migrated `ClickHouseProcessMiningRepository` and `ClickHouseRootCauseRepository` transport paths to `AsyncClickHouseClient`, removed repository-local `httpx.AsyncClient` usage, and preserved deterministic ordering plus repository-level domain error mapping.
6. 2026-03-01: Phase 4 made SQLAlchemy Core (`clickhousedb` dialect) the single runtime ClickHouse path by introducing a shared SQLAlchemy utility, switching shared client execution to that utility, removing `FORMAT JSON` query-shape dependencies from history/process/RCA repositories, and retaining repository-level domain error translation and deterministic ordering semantics.
7. 2026-03-01: Phase 5 ran full backend validation and docs finalization: `cd seer-backend && uv run pytest -q` passed (`59 passed, 99 warnings in 21.38s`; warnings are existing FastAPI deprecation notices), `cd seer-backend && uv run ruff check src tests` passed (`All checks passed!`). Post-MVP execution state was updated and OC-DFG dependency block was cleared.
8. 2026-03-01: Added Phase 6 independent compliance audit requirement so plan completion requires a fresh subagent review against the SQLAlchemy dialect utilization model.
9. 2026-03-01: Closed independent audit remediation gaps: history/process/RCA runtime query construction now defaults to SQLAlchemy Core statements (`select/join/where/order/limit/distinct`) rather than raw SQL string assembly, ClickHouse SQLAlchemy engine now receives DSN/options plumbing for compression/query_limit/connect+send-receive timeouts from `SEER_CLICKHOUSE_*` settings, and explicit runtime limitations were encoded in code/docs (no update expectation, no transaction guarantees, no RETURNING/sequence reliance). Validation evidence: `cd seer-backend && uv run ruff check src/seer_backend/clickhouse src/seer_backend/history/repository.py src/seer_backend/analytics/repository.py src/seer_backend/analytics/rca_repository.py` (`All checks passed!`), `cd seer-backend && uv run pytest -q tests/test_history_phase2.py` (`12 passed`), `cd seer-backend && uv run pytest -q tests/test_process_phase3.py` (`6 passed`), `cd seer-backend && uv run pytest -q tests/test_root_cause_phase4.py` (`5 passed`).
