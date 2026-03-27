# OCPN pm4py Placeholder Removal

**Status:** completed  
**Date:** 2026-03-13  
**Owner:** Codex

## Objective

Remove the remaining `pm4py` placeholder/fallback scaffolding from the legacy `/api/v1/process/mine` OCPN path and make the deterministic miner the explicit backend implementation.

## Invariants

1. `/api/v1/process/mine` remains available with its current response contract.
2. Trace drill-down compatibility remains unchanged.
3. No new process-mining tables are added.
4. Backend `pm4py` dependency is removed if no live backend path still requires it.

## Legacy Behavior Removal

1. Remove the OCPN wrapper contract that pretends to prefer `pm4py` but always runs deterministic mining.
2. Remove the runtime warning about missing `pm4py` from `/process/mine`.

## Phases

### Phase 1: Remove Backend Placeholder Scaffolding

1. Remove `Pm4pyObjectCentricInput`, `_to_pm4py_input`, and `_pm4py_available` usage from the OCPN path.
2. Simplify the OCPN miner interface so it is explicitly deterministic.
3. Remove the backend `pm4py` dependency if no backend code still uses it.

### Phase 2: Validation And Docs

1. Update current source-of-truth docs/README for the OCPN path.
2. Run targeted backend validation.
3. Archive the plan.

## Progress Checklist

- [x] Phase 1 complete
- [x] Phase 2 complete

## Validation Ledger

- 2026-03-13: `cd seer-backend && uv run pytest tests/test_process_phase3.py` passed (`14 passed`).
- 2026-03-13: `cd seer-backend && uv run ruff check src/seer_backend/analytics tests/test_process_phase3.py tests/test_ai_phase5.py` passed.
- 2026-03-13: `cd seer-backend && uv run pytest tests/test_process_phase3.py tests/test_ai_phase5.py` passed (`40 passed`).

## Decision Log

- 2026-03-13: Follow-up requested after the OC-DFG replacement. Remaining backend `pm4py` usage is only placeholder/fallback scaffolding on the older OCPN path and should be removed.
- 2026-03-13: Removed the OCPN pseudo-`pm4py` branch entirely instead of retaining a dormant extension point. The old code never executed `pm4py`; it only allocated placeholder payloads and emitted a warning before running the deterministic miner anyway.
- 2026-03-13: Removed backend `pm4py` from `pyproject.toml` and refreshed `uv.lock` because no live backend code path still depends on it.
