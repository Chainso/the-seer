# OC-DFG Trace/Workflow Scope Removal

**Status:** completed  
**Date:** 2026-03-14  
**Owner:** Codex

## Objective

Remove `traceId` and `workflowId` as user-settable scope inputs for OC-DFG and related process-mining inspector flows.

## Invariants

1. `POST /api/v1/process/ocdfg/mine` remains the canonical OC-DFG mining endpoint.
2. Process-mining scope remains object-model plus time-window based.
3. Backend request validation continues to reject unknown process-mining fields.

## Scope

1. Remove trace/workflow inputs and URL params from the inspector process-mining UI.
2. Remove matching dead request/query fields from shared frontend analytics/process-mining types.
3. Keep the backend process-mining contract aligned with the frontend removal.
4. Update the process explorer spec and backend API docs.

## Progress Checklist

- [x] Frontend/UI removal complete
- [x] Backend contract alignment complete
- [x] Validation complete
- [x] Plan archived

## Validation Ledger

- 2026-03-14: `cd seer-ui && node --test tests/insights.contract.test.mjs` passed.
- 2026-03-14: `cd seer-ui && npm run build` passed.
- 2026-03-14: `cd seer-backend && ./.venv/bin/pytest tests/test_process_phase3.py` passed (`15 passed`).
- 2026-03-14: `cd seer-backend && ./.venv/bin/ruff check tests/test_process_phase3.py` passed.

## Decision Log

- 2026-03-14: The backend process-mining request models already use `extra="forbid"`, so no backend runtime query change was required for this removal.
- 2026-03-14: Removed the stale UI fields and URL persistence rather than hiding them, to keep the process-mining surface aligned with the actual backend contract.
- 2026-03-14: Removed the same dead scope fields from ontology analytics because that flow reuses the same process-mining request adapter and should not imply unsupported narrowing semantics.
