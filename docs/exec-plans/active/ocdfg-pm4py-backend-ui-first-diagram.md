# Post-MVP Exec Plan: OC-DFG as Primary Process Diagram (pm4py + ClickHouse/Polars)

**Status:** blocked (depends on clickhouse-connect migration)  
**Track:** post-MVP analytics UX + backend contract extension  
**Last updated:** 2026-03-01

---

## Objective

Make Object-Centric Directly-Follows Graphs (OC-DFG) the first process diagram in the Inspector Insights experience, powered by a new backend endpoint that runs `pm4py` OC-DFG discovery from ClickHouse-extracted data via Polars-to-pandas transformation.

## Delivery Stance

1. Forward-only UX/backend delivery: do not preserve legacy process-mining behavior by default.
2. If OC-DFG-first delivery requires breaking legacy OCPN/BPMN flow assumptions, prefer the best target outcome and update contracts/docs accordingly.
3. Any retained legacy behavior must be explicitly justified; default is to remove it.

## Scope

1. Add a new process mining backend endpoint dedicated to OC-DFG discovery with `pm4py`.
2. Implement ClickHouse extraction flow that materializes Polars DataFrames and converts to pandas for `pm4py` OCEL input.
3. Return a deterministic OC-DFG UI contract (activities, object-type-scoped edges, start/end metrics, warnings, trace handles).
4. Update process mining UI so OC-DFG is rendered as the first diagram users see after running mining.
5. Preserve trace drill-down behavior for OC-DFG elements via existing handle mechanics.
6. Add backend and UI tests for contract stability, determinism, and failure modes.

## Non-Goals

1. Replacing existing OCPN endpoint behavior in this change.
2. Adding conformance/simulation features.
3. Full performance hardening for very large datasets beyond configured guardrails.

## Design Decisions (Locked for This Plan)

1. The OC-DFG endpoint is explicitly `pm4py`-backed; if dependency/runtime is unavailable, return actionable dependency error instead of silently swapping algorithms.
2. Existing process-mining contracts may be changed when needed to optimize OC-DFG-first outcomes; documentation and UI/backend consumers must be updated in the same change.
3. OC-DFG trace drill-down reuses existing `/api/v1/process/traces` by emitting compatible selector handles.
4. UI prioritizes OC-DFG as the default first diagram; OCPN/BPMN remain secondary views.

## Endpoint Contract Plan

1. Add `POST /api/v1/process/ocdfg/mine`.
2. Request contract mirrors current process run filters:
   - `anchor_object_type`, `start_at`, `end_at`,
   - optional `include_object_types`, `max_events`, `max_relations`, `max_traces_per_handle`.
3. Response contract includes:
   - run metadata (`run_id`, anchor/window),
   - `nodes[]` keyed by activity (frequency by object-type aggregate),
   - `edges[]` keyed by `(source_activity, target_activity, object_type)` with count/share and trace handle,
   - `start_activities[]` and `end_activities[]` by object type,
   - optional performance stats derived from pm4py edge performance (`p50_seconds`, `p95_seconds`),
   - `object_types[]`, `warnings[]`.

## Backend Implementation Plan

### Phase 1: Dataframe Extraction Path (ClickHouse -> Polars)

1. Add backend dependency on `polars` (and explicit `pandas` pin if not already direct).
2. Extend analytics repository with an OC-DFG extraction path that returns Polars frames for:
   - events (`event_id`, `event_type`, `occurred_at`),
   - objects (`object_id`, `object_type`),
   - relations (`event_id`, `object_id`, `object_type`, plus event activity/timestamp fields required by OCEL relations).
3. Keep current guardrails (`max_events`, `max_relations`) enforced before expensive transforms.
4. Ensure deterministic sort order before conversion to pandas.

### Phase 2: pm4py OCEL + OC-DFG Discovery

1. Build OCEL DataFrames with pm4py canonical columns:
   - events: `ocel:eid`, `ocel:activity`, `ocel:timestamp`,
   - objects: `ocel:oid`, `ocel:type`,
   - relations: `ocel:eid`, `ocel:oid`, `ocel:activity`, `ocel:timestamp`, `ocel:type`.
2. Convert Polars -> pandas with timezone-safe timestamp handling (`datetime64[ns, UTC]`).
3. Execute `pm4py.algo.discovery.ocel.ocdfg.algorithm.apply(ocel)` and normalize output maps into stable API payload arrays.
4. Generate trace handles for OC-DFG nodes/edges/start/end entries using existing stateless handle scheme.

### Phase 3: API Surface + Wiring

1. Add OC-DFG request/response Pydantic models in analytics contracts module.
2. Add OC-DFG service method in analytics service layer.
3. Add FastAPI route in `seer_backend/api/process.py` and map domain errors to HTTP statuses.
4. Keep service initialization compatibility with current process service bootstrap.

### Phase 4: Tests

1. Unit tests for transformation:
   - frame -> Polars -> pandas -> OCEL shape checks,
   - deterministic normalization ordering.
2. API contract tests:
   - happy path returns OC-DFG payload with trace handles,
   - invalid window / oversized scope / no data / missing dependency behavior.
3. Determinism test: same snapshot yields same sorted nodes/edges/start/end payload.

## UI Implementation Plan

### Phase 5: OC-DFG as First Diagram

1. Add frontend API client for `POST /process/ocdfg/mine`.
2. Add OC-DFG graph type/contracts in `seer-ui/app/types/process-mining.ts`.
3. Implement OC-DFG graph component (activity nodes + object-type colored edges with share/count legend).
4. Update `process-mining-panel.tsx` to:
   - run OC-DFG mining for the primary diagram,
   - render OC-DFG card first,
   - keep OCPN/BPMN as secondary analysis views.
5. Ensure selected-node and edge interaction still supports trace drill-down.

### Phase 6: Frontend Tests

1. Contract tests for OC-DFG panel rendering and error handling.
2. Ensure Insights panel still exposes process mining entrypoint and no broken navigation contracts.

## Acceptance Criteria

1. Running process mining from Inspector renders OC-DFG first with non-empty seeded datasets.
2. OC-DFG payload is generated by `pm4py` OC-DFG discovery (not deterministic fallback algorithm).
3. ClickHouse extraction path uses Polars intermediate frames and pandas conversion for pm4py input.
4. OC-DFG nodes/edges include trace handles that resolve via `/api/v1/process/traces`.
5. Guardrail and validation failures return actionable errors consistent with existing process APIs.
6. Legacy process-mining behavior retained (if any) is explicitly documented with rationale; otherwise obsolete behavior is removed.

## Risks and Mitigations

1. **Risk:** pm4py OCEL expects strict column names/types and fails on timestamp/object-id mismatches.  
   **Mitigation:** explicit schema validation before discovery + focused unit tests on OCEL conversion.
2. **Risk:** Polars/pandas conversion overhead for large scopes.  
   **Mitigation:** preserve hard guardrails and deterministic bounded query limits; instrument run-size logging.
3. **Risk:** UI confusion with multiple process diagrams.  
   **Mitigation:** explicit section ordering and labels: OC-DFG primary, OCPN/BPMN secondary.

## Documentation Updates Required in Same Change

1. Update `docs/product-specs/process-explorer-phase-3.md` with OC-DFG-first flow and backend contract additions.
2. Update `seer-backend/README.md` process API section to include OC-DFG endpoint.
3. Update `docs/exec-plans/active/index.md` progress and pointer to this plan.
4. If endpoint semantics alter stable architecture boundaries, update `ARCHITECTURE.md` contract list accordingly.

## Exit Conditions

1. All acceptance criteria are met with passing backend + frontend tests.
2. Plan status moved to `completed` and file archived under `docs/exec-plans/completed/`.
3. Any deferred items are recorded in `docs/exec-plans/tech-debt-tracker.md`.
