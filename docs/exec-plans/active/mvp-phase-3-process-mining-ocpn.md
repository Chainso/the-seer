# MVP Phase 3 Exec Plan: Process Mining v1 (Object-Centric Petri Nets)

**Status:** in_progress  
**Target order:** 3 of 6  
**Agent slot:** A4  
**Predecessor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-2-event-history-ingestion.md`  
**Successor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/active/mvp-phase-4-root-cause-analysis-v1.md`
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
2. **Input dataset contract:** extraction returns three Arrow-backed frames (`events`, `objects`, `relations`) derived from the three core tables.
3. **Time field for mining:** always use `occurred_at`.
4. **Run anchor requirements:** request must include `anchor_object_type` and time window.
5. **Oversized run behavior:** return validation error with guidance to narrow filters when bounded limits are exceeded.
6. **UI model payload:** backend returns normalized graph payload (`nodes`, `edges`, `object_types`, `path_stats`) plus trace lookup handles.

## Implementation Steps

1. Define process mining request contract and validation rules.
2. Implement extraction SQL templates and Arrow retrieval path.
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
   **Mitigation:** enforce explicit extraction contract and fixture-based transform tests.
2. **Risk:** users trigger unbounded runs.  
   **Mitigation:** strict input validation with mandatory anchors and time windows.
