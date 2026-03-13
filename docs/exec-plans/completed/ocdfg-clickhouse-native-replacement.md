# OC-DFG ClickHouse-Native Replacement

**Status:** completed  
**Date:** 2026-03-13  
**Owner:** Codex

## Objective

Replace the backend `pm4py` OC-DFG runtime path with ClickHouse-native OC-DFG mining while preserving the current API contract shape consumed by UI and AI surfaces.

## Invariants

1. `POST /api/v1/process/ocdfg/mine` remains the canonical OC-DFG backend endpoint.
2. OC-DFG payload arrays stay deterministic for the same history snapshot.
3. Trace drill-down handles remain compatible with shared `GET /api/v1/process/traces`.
4. No new analytics fact table is introduced for this work.
5. Legacy `pm4py` runtime dependency is removed from the OC-DFG execution path and documented accordingly.

## Legacy Behavior Removal

1. Remove backend dependence on `pm4py` for OC-DFG mining.
   Rationale: the current path extracts ClickHouse data only to rematerialize it into Python dataframes for `pm4py`, which adds avoidable dependency, memory, and serialization overhead.
2. Remove OC-DFG dependency-error behavior tied specifically to missing `pm4py`.
   Rationale: ClickHouse-native mining should fail only on repository/runtime query issues, not on a Python process-mining package.

## Phase Map

### Phase 1: Plan, Baseline, And Query Strategy

Scope:
1. Confirm current repository/service/test/doc surface.
2. Record baseline validation status relevant to process mining.
3. Finalize ClickHouse-native OC-DFG query design and migration scope.

Exit criteria:
1. Baseline validation ledger captured in this plan.
2. Query strategy and schema decision logged.

Validation:
1. `cd seer-backend && pytest tests/test_process_phase3.py`

### Phase 2: Backend And Schema Implementation

Scope:
1. Replace `extract_ocdfg_frames`/`pm4py` service flow with repository-native OC-DFG query results.
2. Expand existing history schema only if needed to support better OC-DFG locality; no new table.
3. Keep OCPN `/process/mine` behavior unchanged for this task.

Exit criteria:
1. OC-DFG mining runs without `pm4py`.
2. ClickHouse repository returns deterministic OC-DFG metrics directly.
3. In-memory repository/test path mirrors the backend contract.

Validation:
1. `cd seer-backend && pytest tests/test_process_phase3.py`

### Phase 3: Documentation And Contract Ratification

Scope:
1. Update canonical docs/specs/README to reflect ClickHouse-native OC-DFG mining.
2. Update execution-plan indexes and archive the completed plan.

Exit criteria:
1. Docs no longer describe OC-DFG as `pm4py`-backed.
2. Active/completed plan indexes remain accurate.

Validation:
1. `cd seer-backend && pytest tests/test_process_phase3.py`

## Progress Checklist

- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete

## Validation Ledger

- 2026-03-13: `cd seer-backend && pytest tests/test_process_phase3.py` failed in the bare shell because backend dependencies were not installed (`ModuleNotFoundError: fastapi` during test collection).
- 2026-03-13: `cd seer-backend && uv run pytest tests/test_process_phase3.py` passed (`15 passed`).
- 2026-03-13: `cd seer-backend && uv run ruff check src/seer_backend/analytics src/seer_backend/history tests/test_process_phase3.py` passed.
- 2026-03-13: `cd seer-backend && uv run pytest tests/test_process_phase3.py` passed after the OC-DFG replacement (`14 passed`).

## Decision Log

- 2026-03-13: Started plan for replacing backend OC-DFG `pm4py` discovery with ClickHouse-native mining. Constraint from user: do not add a new table; expand current schema/query path only if needed.
- 2026-03-13: Baseline validation will use `uv run ...` for backend commands because the bare interpreter environment is intentionally incomplete in this workspace.
- 2026-03-13: Chose a ClickHouse-native OC-DFG implementation over existing `event_history` + `event_object_links` rather than adding a new fact table. With the current schema, time-window pruning is best driven from `event_history` and then joined into object links for deterministic edge reconstruction.
- 2026-03-13: Kept the OCPN `/process/mine` path unchanged for this task. The OC-DFG replacement is isolated to `/process/ocdfg/mine` plus richer metric-family counts on the OC-DFG response objects.
