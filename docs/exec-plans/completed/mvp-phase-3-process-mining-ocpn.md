# MVP Phase 3 Exec Plan: Process Mining v1 (Object-Centric Petri Nets)

**Status:** completed  
**Target order:** 3 of 6  
**Agent slot:** A4  
**Predecessor:** `docs/exec-plans/completed/mvp-phase-2-event-history-ingestion.md`  
**Successor:** `docs/exec-plans/completed/mvp-phase-4-root-cause-analysis-v1.md`
**Last updated:** 2026-02-22

---

## Objective

Deliver the first production-usable object-centric process mining workflow using `pm4py` over Arrow-backed ClickHouse extracts.

## Scope

1. Build ClickHouse extraction queries for process mining datasets.
2. Convert extracted data into `pm4py` object-centric input structures.
3. Run object-centric Petri net generation.
4. Expose process model and trace drill-down APIs.
5. Implement UI process explorer for model visualization and trace navigation.

## Non-Goals

1. Non-object-centric mining algorithms.
2. Performance tuning for very large datasets beyond MVP guardrails.
3. Advanced simulation/conformance suites.

## Ambiguities Resolved

1. **Mining method scope:** object-centric Petri nets only.
2. **Input dataset contract:** extraction returns three frames (`events`, `objects`, `relations`) from the three core history tables.
3. **Time field for mining:** always use `occurred_at`.
4. **Run anchor requirements:** request must include `anchor_object_type` and time window.
5. **Oversized run behavior:** return validation error with guidance to narrow filters when bounded limits are exceeded.
6. **UI model payload:** backend returns normalized graph payload (`nodes`, `edges`, `object_types`, `path_stats`) plus trace lookup handles.
7. **Runtime dependency fallback:** if `pm4py` is unavailable in local runtime, use deterministic fallback miner while preserving API and transform contracts.

## Implementation Steps

1. Define process mining request contract and validation rules.
2. Implement extraction SQL templates and ClickHouse retrieval path.
3. Implement transform layer from extracted frames to `pm4py` object-centric inputs.
4. Implement mining service wrapper for Petri net generation.
5. Implement serialization layer for UI rendering and drill-down APIs.
6. Implement UI process explorer with:
   - model render,
   - filter controls,
   - map-to-trace drill-down.
7. Add tests on representative seeded datasets.

## Acceptance Criteria

1. User can run object-centric mining from UI with explicit anchor and time window.
2. Backend returns deterministic process model for same input dataset snapshot.
3. UI supports node/edge click-through to supporting traces.
4. Mining errors are actionable (invalid filters, oversized scope, missing data).
5. End-to-end flow works using data persisted by Phase 2 ingestion.

## Handoff Package to Phase 4

1. Mining API contract and sample requests.
2. Process model payload schema and UI field definitions.
3. Drill-down trace API contract and response examples.
4. Performance guardrail settings and known limits.
5. Dataset fixtures used to validate mining reproducibility.

## Risks and Mitigations

1. **Risk:** shape mismatch between ClickHouse extracts and `pm4py` expectations.  
   **Mitigation:** explicit extraction contract + transform tests + wrapper fallback behavior.
2. **Risk:** users trigger unbounded runs.  
   **Mitigation:** strict validation with mandatory anchors/time windows and max row guardrails.

## Completion Summary

1. Implemented Phase 3 backend analytics domain:
   - request/response contracts and validation,
   - ClickHouse extraction repository for `events`/`objects`/`relations` frames,
   - transform layer to `pm4py`-compatible object-centric inputs,
   - OCPN wrapper service with deterministic fallback miner,
   - trace-handle encoding + drill-down filtering.
2. Implemented new Process API endpoints:
   - `POST /api/v1/process/mine`
   - `GET /api/v1/process/traces`
3. Added runtime wiring and guardrail settings:
   - process service injection in FastAPI app bootstrap,
   - configurable `max_events`, `max_relations`, and drill-down trace limits.
4. Replaced Process Explorer shell page with MVP-thin interactive UI:
   - anchor/time-window run form,
   - model output lists (`nodes`, `edges`, `path_stats`),
   - trace drill-down panel wired to backend handles.
5. Added Phase 3 fixture-driven tests with Phase 2-compatible seeded history data.

## Decision Log

1. Extraction and mining operate directly on the three immutable Phase 2 core tables; no derived tables were added.
2. Drill-down handles are stateless encoded selectors plus run context, enabling deterministic re-query instead of server-side handle storage.
3. `pm4py` integration is wrapped with dependency detection; missing runtime dependency falls back to deterministic mining while preserving contract shape and determinism guarantees.
4. Guardrails are enforced at extraction boundary and return actionable guidance when limits are exceeded.

## Acceptance Evidence

1. `cd seer-backend && uv run ruff check src/seer_backend/analytics src/seer_backend/api/process.py src/seer_backend/main.py src/seer_backend/config/settings.py tests/test_process_phase3.py`  
   Result: `All checks passed!`
2. `cd seer-backend && uv run pytest tests/test_process_phase3.py -q`  
   Result: `6 passed`.
3. `cd seer-backend && uv run pytest -q`  
   Result: `26 passed`.
4. `cd seer-ui && npm run lint`  
   Result: `eslint` completed with no errors.
5. `cd seer-ui && npm run build`  
   Result: Next.js production build succeeded; `/process` route generated successfully.

## Mining API Contract and Samples

1. `POST /api/v1/process/mine`
   - request fields: `anchor_object_type`, `start_at`, `end_at`, optional `include_object_types`, `max_events`, `max_relations`, `max_traces_per_handle`.
   - response fields: `run_id`, `anchor_object_type`, `start_at`, `end_at`, `nodes`, `edges`, `object_types`, `path_stats`, `warnings`.
2. sample request:

```json
{
  "anchor_object_type": "Order",
  "start_at": "2026-02-22T09:00:00Z",
  "end_at": "2026-02-22T11:00:00Z"
}
```

3. sample response fields include:
   - `nodes[].trace_handle`
   - `edges[].trace_handle`
   - `path_stats[].trace_handle`

## Drill-Down Trace Contract and Sample

1. `GET /api/v1/process/traces?handle=<trace_handle>&limit=25`
2. response fields:
   - `handle`,
   - `selector_type`,
   - `traces[]` (with `object_type`, `object_ref_hash`, `object_ref_canonical`, `event_ids`, `event_types`, `start_at`, `end_at`, `trace_id`),
   - `matched_count`,
   - `truncated`.

## Performance Guardrails and Known Limits

1. default max events per mining run: `5000`.
2. default max relations per mining run: `40000`.
3. default max traces returned per drill-down call: `100`.
4. exceeded limits return HTTP `413` with guidance to narrow filters.

## Dataset Fixtures for Reproducibility

1. Representative seeded fixture is encoded in `seer-backend/tests/test_process_phase3.py` and includes an `Order` anchor flow with related `Invoice` and `Shipment` objects.
2. Seed flow is ingested through the Phase 2 history endpoint (`/api/v1/history/events/ingest`) before mining assertions.

## Doc Updates

1. Moved this plan from `docs/exec-plans/active/` to `docs/exec-plans/completed/`.
2. Updated execution index and roadmap references so Phase 4 is now active in progress.
3. Updated completed-plan listing to include Phase 3.
4. Updated backend and UI surfaces to reflect Process Explorer Phase 3 functionality.

## Known Issues

1. `pm4py` is not installed in this workspace runtime; wrapper uses deterministic fallback miner and emits warning in response payload.
2. FastAPI startup hook still uses deprecated `on_event("startup")` and remains outside Phase 3 scope.

## Next-Phase Starter Context

1. Process API + orchestration:
   - `seer-backend/src/seer_backend/api/process.py`
   - `seer-backend/src/seer_backend/analytics/service.py`
2. Extraction and frame contracts:
   - `seer-backend/src/seer_backend/analytics/repository.py`
   - `seer-backend/src/seer_backend/analytics/models.py`
3. UI surface:
   - `seer-ui/src/components/process-explorer.tsx`
   - `seer-ui/src/lib/backend-process.ts`
4. Phase 3 test fixtures and acceptance checks:
   - `seer-backend/tests/test_process_phase3.py`
