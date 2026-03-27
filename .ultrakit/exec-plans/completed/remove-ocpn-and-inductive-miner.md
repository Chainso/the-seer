# Remove OCPN And Inductive Miner

**Status:** completed  
**Date:** 2026-03-14  
**Owner:** Codex

## Objective

Remove the Object-Centric Petri Net and inductive-miner/BPMN path from the current process-mining experience, and retire the legacy `/api/v1/process/mine` endpoint once the frontend no longer depends on it.

## Invariants

1. `POST /api/v1/process/ocdfg/mine` remains the canonical process-mining endpoint.
2. `GET /api/v1/process/traces` remains the shared drill-down path for OC-DFG handles.
3. Current inspector process mining is OC-DFG-only rather than preserving secondary legacy diagrams.

## Legacy Behavior Removal (Intentional)

1. Removed the secondary OCPN panel from `/inspector/insights`.
2. Removed the tertiary BPMN/inductive-miner panel and its collapse toggle.
3. Removed the legacy `/api/v1/process/mine` route after migrating the last frontend consumer off it.

Rationale: OCPN and BPMN are no longer part of the intended current product surface; keeping them as secondary legacy diagrams added UI and backend contract weight without improving the target user experience.

## Progress Checklist

- [x] Phase 1 complete
- [x] Phase 2 complete

## Validation Ledger

- 2026-03-14: `cd seer-ui && node --test tests/insights.contract.test.mjs` passed.
- 2026-03-14: `cd seer-ui && npm run build` passed.
- 2026-03-14: `cd seer-backend && ./.venv/bin/pytest tests/test_process_phase3.py` passed (`8 passed`).
- 2026-03-14: `cd seer-backend && ./.venv/bin/pytest tests/test_ai_phase5.py -k 'process_interpretation or process_skill_unlocks_ocdfg_tool_and_persists_result'` passed (`2 passed`).
- 2026-03-14: `cd seer-backend && ./.venv/bin/ruff check src/seer_backend/api/process.py src/seer_backend/analytics/service.py tests/test_process_phase3.py tests/test_ai_phase5.py` passed.

## Decision Log

- 2026-03-14: The ontology analytics overlay was the last current frontend consumer of `/api/v1/process/mine`; moving it to OC-DFG allowed the legacy route to be retired instead of preserved for a dead UI path.
- 2026-03-14: Removed the `pm4js` dependency and the OCPN/BPMN-only React components once the process-mining page no longer referenced them.
- 2026-03-14: Kept the deterministic process-map service/model internals for backend AI flows; only the unused HTTP route and UI surface were removed in this change.
