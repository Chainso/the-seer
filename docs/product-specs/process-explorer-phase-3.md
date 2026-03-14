# Process Explorer Phase 3 Spec

**Status:** completed  
**Owner phase:** `docs/exec-plans/completed/ocdfg-ui-layout-engine-upgrade.md`  
**Last updated:** 2026-03-14

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
6. UI immediately surfaces a visible completed-state summary or jump target when mining succeeds.
7. UI requests `POST /api/v1/process/ocdfg/mine` and renders OC-DFG first:
   - `nodes`,
   - `edges`,
   - `start_activities`,
   - `end_activities`,
   - `object_types`,
   - optional edge performance percentiles (`p50_seconds`, `p95_seconds`).
8. The completed-state summary exposes direct navigation into the OC-DFG result section.
9. OC-DFG visualization behavior:
   - object nodes are displayed per included object type,
   - start edges render from object nodes to their start activities,
   - activity and object nodes render ontology display names (no raw URI text in visible labels),
   - event nodes related to exactly one object type use a lighter variant of that object-type color.
10. Shared links and refreshes restore the visible mining mode, core scope controls, and completed-state result context when encoded in the URL.
11. User clicks a node, edge, start activity, or end activity entry.
12. UI requests trace drill-down with the backend handle and renders matching traces.

## Backend Contracts Consumed by UI

1. `POST /api/v1/process/ocdfg/mine` (primary mining run)
2. `GET /api/v1/process/traces` (shared drill-down for OC-DFG handles)

Mining request scope semantics:

1. UI sends explicit `include_object_types[]` (resolved from selected object models) to both mining endpoints.
2. Backend mines events in the time window where at least one included object type participates.
3. Relation/object extraction is filtered to included object types.
4. If `include_object_types` is omitted, backend falls back to anchor-only behavior (`anchor_object_type`).
5. `POST /api/v1/process/ocdfg/mine` may additionally accept optional `anchor_filters[]` for anchor-object payload filtering.
6. `anchor_filters[]` currently supports only `anchor.<field>` payload paths for the Object Store RCA comparison flow.
7. Non-anchor RCA rule families are intentionally out of scope for OC-DFG comparison v1 and must not be silently approximated.
8. Mining scope does not accept user-supplied `traceId` or `workflowId`; narrowing happens through object-model scope, time window, anchor filters when present, and trace drill-down after the run.

## Acceptance Expectations

1. OC-DFG run request enforces required anchor and valid time window.
2. OC-DFG response includes trace handles for `nodes`, `edges`, `start_activities`, and `end_activities`.
3. OC-DFG mining is generated directly from ClickHouse-backed backend queries rather than a Python process-mining package handoff.
4. Shared drill-down returns trace lists keyed by selected OC-DFG model element.
5. Empty/oversized/invalid requests produce actionable error messages surfaced in UI.
6. Re-running against unchanged data snapshot produces deterministic ordering for OC-DFG payload arrays.
7. Depth changes update included object scope immediately in the UI.
8. OC-DFG response surfaces metric-family counts for nodes, edges, and start/end activities in addition to the existing `count` fields.
9. OC-DFG UI includes object nodes and object-to-start-activity edges in the rendered node/edge model.
10. OC-DFG object and activity node labels are ontology-display driven for user-facing names.
11. A successful mining run creates an obvious visible completion state at the current viewport.
12. Completed-state summaries and warning/empty-result states remain visible and understandable after the run finishes.
13. URL-backed mining state restores tab, scope, and run-completed context across refresh and direct links.
14. Invalid or partial mining query params normalize safely instead of breaking the view.
15. Trace handles preserve `anchor_filters[]` context when filtered OC-DFG runs are used for comparison.

## Out of Scope (Phase 3)

1. Conformance checking and simulation.
2. Large-dataset tuning beyond configured guardrails.
3. Non-object-centric mining methods.
4. OC-DFG comparison support for non-anchor RCA rule families such as event-count/presence or depth-neighbor payload features.
