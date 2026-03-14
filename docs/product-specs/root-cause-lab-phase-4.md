# Root-Cause Lab Phase 4 Spec

**Status:** completed  
**Owner phase:** `docs/exec-plans/completed/mvp-phase-4-root-cause-analysis-v1.md`  
**Last updated:** 2026-03-14

---

## Purpose

Define user-facing behavior for MVP Root-Cause Lab configuration, ranked insights, evidence drill-down, and MVP-thin AI assist.

## Primary User Flow

1. User opens `/root-cause`.
2. User enters:
   - `anchor_object_type`,
   - `start_at`,
   - `end_at`,
   - `depth` (1-3),
   - run-scoped `outcome` definition,
   - optional cohort `filters`.
3. User runs RCA request.
4. UI immediately surfaces a visible completed-state summary or jump target into ranked insights and evidence.
5. UI renders ranked insights with WRAcc/lift/coverage and evidence drill-down controls.
6. Refreshing or sharing a URL with encoded RCA state restores the visible RCA context and reruns when required inputs are present.
7. User opens evidence drill-down for a selected insight and inspects supporting traces.
8. User can invoke AI assist to:
   - draft setup suggestions,
   - summarize top findings and caveats.

## Backend Contracts Consumed by UI

1. `POST /api/v1/root-cause/run`
2. `GET /api/v1/root-cause/evidence`
3. `POST /api/v1/root-cause/assist/setup`
4. `POST /api/v1/root-cause/assist/interpret`

## Object Store Embedding Notes

1. Object Store does not embed the full standalone RCA surface.
2. Inside Object Store, RCA is reduced to:
   - shared time/depth scope,
   - outcome selection,
   - manual run,
   - ranked result table,
   - optional OC-DFG comparison for anchor-field-only insights.
3. Object Store does not render RCA evidence traces or AI interpretation panels in this combined workspace.
4. If a selected RCA insight contains non-anchor rule families, Object Store keeps the result selectable but does not render a comparison OC-DFG for it.

## Acceptance Expectations

1. Run request enforces explicit anchor/time window/depth/outcome contract.
2. Insight list includes score/coverage/lift and clear associative caveats.
3. Evidence drill-down returns supporting traces for selected insight handles.
4. Re-running unchanged snapshot preserves ranked ordering deterministically.
5. AI assist output supports setup/interpretation and repeats non-causal caveats.
6. A successful RCA run creates an obvious visible completion state at the current viewport.
7. Ranked-insight and evidence entry points remain visible and understandable after completion, including warning or low-signal outcomes.
8. URL-backed RCA state restores core scope, filters, and completed run context safely across refresh and direct links.

## Out of Scope (Phase 4)

1. Causal inference guarantees beyond statistical association.
2. Unbounded traversal depth or unrestricted search-space exploration.
3. Unified cross-module AI orchestration hardening (Phase 5 scope).
