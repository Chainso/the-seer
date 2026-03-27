# OC-DFG Edge Query Null-Lag Fix

**Status:** completed  
**Date:** 2026-03-14  
**Owner:** Codex

## Objective

Fix the ClickHouse-native OC-DFG edge query so the first event in each object partition does not produce a synthetic edge with empty `source_activity` and epoch-scale durations.

## Invariants

1. `POST /api/v1/process/ocdfg/mine` remains the canonical OC-DFG endpoint.
2. The OC-DFG frontend continues to trust backend graph ids and fail fast on invalid payloads.
3. Real OC-DFG edges keep their current contract shape and deterministic ordering.

## Scope

1. Patch the backend edge query to exclude first-in-partition lag defaults.
2. Add regression coverage for empty-source synthetic edges.
3. Archive the plan after validation.

## No-Doc-Impact

1. No product/spec/architecture docs require content changes for this fix.
   Reason: this is a backend correctness repair for the existing OC-DFG contract, not a user-facing behavior change in intended scope.

## Validation

1. `cd seer-backend && uv run pytest tests/test_process_phase3.py`
2. `cd seer-ui && node --test tests/process-mining.contract.test.mjs`

## Progress Checklist

- [x] Query patch complete
- [x] Regression coverage complete
- [x] Validation complete
- [x] Plan archived

## Validation Ledger

- 2026-03-14: `cd seer-backend && uv run pytest tests/test_process_phase3.py` passed (`15 passed`).
- 2026-03-14: `cd seer-backend && uv run ruff check src/seer_backend/analytics/repository.py tests/test_process_phase3.py` passed.
- 2026-03-14: `cd seer-ui && node --test tests/process-mining.contract.test.mjs` passed.

## Decision Log

- 2026-03-14: Confirmed the empty-source OC-DFG edges are produced by ClickHouse `lagInFrame` defaults on non-nullable columns, which survive `WHERE previous_event_id IS NOT NULL`.
- 2026-03-14: Fixed the query by wrapping lagged predecessor columns in `toNullable(...)` before `lagInFrame(...)`, preserving the existing `WHERE previous_event_id IS NOT NULL` filter while making first-in-partition rows disappear instead of materializing as empty-source synthetic edges.
