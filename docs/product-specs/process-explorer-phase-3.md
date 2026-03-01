# Process Explorer Phase 3 Spec

**Status:** completed  
**Owner phase:** `docs/exec-plans/completed/ocdfg-ui-layout-engine-upgrade.md`  
**Last updated:** 2026-03-01

---

## Purpose

Define user-facing behavior for OC-DFG-first process mining and trace drill-down in Inspector Insights.

## Primary User Flow

1. User opens `/inspector/insights` and selects `Process Mining`.
2. User enters:
   - `anchor_object_type`,
   - `depth` (default `1`),
   - `start_at`,
   - `end_at`.
3. UI resolves included object models from ontology graph using anchor + depth:
   - `depth=1`: anchor only,
   - `depth=2`: models sharing ontology event references with anchor,
   - `depth>=3`: recursive expansion by shared event references.
4. UI shows resolved included object models before mining runs.
5. User runs mining request.
6. UI requests `POST /api/v1/process/ocdfg/mine` and renders OC-DFG first:
   - `nodes`,
   - `edges`,
   - `start_activities`,
   - `end_activities`,
   - `object_types`,
   - optional edge performance percentiles (`p50_seconds`, `p95_seconds`).
7. OC-DFG visualization behavior:
   - object nodes are displayed per included object type,
   - start edges render from object nodes to their start activities,
   - activity and object nodes render ontology display names (no raw URI text in visible labels),
   - event nodes related to exactly one object type use a lighter variant of that object-type color.
8. UI keeps secondary diagrams available:
   - `POST /api/v1/process/mine` for OCPN,
   - derived BPMN path from collapsed OCPN.
9. User clicks a node, edge, start activity, or end activity entry.
10. UI requests trace drill-down with the backend handle and renders matching traces.

## Backend Contracts Consumed by UI

1. `POST /api/v1/process/ocdfg/mine` (primary mining run)
2. `POST /api/v1/process/mine` (secondary OCPN path)
3. `GET /api/v1/process/traces` (shared drill-down for OC-DFG and OCPN handles)

Mining request scope semantics:

1. UI sends explicit `include_object_types[]` (resolved from selected object models) to both mining endpoints.
2. Backend mines events in the time window where at least one included object type participates.
3. Relation/object extraction is filtered to included object types.
4. If `include_object_types` is omitted, backend falls back to anchor-only behavior (`anchor_object_type`).

## Acceptance Expectations

1. OC-DFG run request enforces required anchor and valid time window.
2. OC-DFG response includes trace handles for `nodes`, `edges`, `start_activities`, and `end_activities`.
3. OC-DFG mining is `pm4py`-backed; missing runtime surfaces actionable dependency errors (503) instead of silent fallback.
4. Shared drill-down returns trace lists keyed by selected OC-DFG or OCPN model element.
5. Empty/oversized/invalid requests produce actionable error messages surfaced in UI.
6. Re-running against unchanged data snapshot produces deterministic ordering for OC-DFG payload arrays.
7. Depth changes update included object scope immediately in the UI.
8. OC-DFG and OCPN mining calls use the same resolved multi-object scope per run.
9. OC-DFG UI includes object nodes and object-to-start-activity edges in the rendered node/edge model.
10. OC-DFG object and activity node labels are ontology-display driven for user-facing names.

## Out of Scope (Phase 3)

1. Conformance checking and simulation.
2. Large-dataset tuning beyond configured guardrails.
3. Non-object-centric mining methods.
