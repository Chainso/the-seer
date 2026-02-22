# Root-Cause Lab Phase 4 Spec

**Status:** completed  
**Owner phase:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-4-root-cause-analysis-v1.md`  
**Last updated:** 2026-02-22

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
4. UI renders ranked insights with WRAcc/lift/coverage and evidence drill-down controls.
5. User opens evidence drill-down for a selected insight and inspects supporting traces.
6. User can invoke AI assist to:
   - draft setup suggestions,
   - summarize top findings and caveats.

## Backend Contracts Consumed by UI

1. `POST /api/v1/root-cause/run`
2. `GET /api/v1/root-cause/evidence`
3. `POST /api/v1/root-cause/assist/setup`
4. `POST /api/v1/root-cause/assist/interpret`

## Acceptance Expectations

1. Run request enforces explicit anchor/time window/depth/outcome contract.
2. Insight list includes score/coverage/lift and clear associative caveats.
3. Evidence drill-down returns supporting traces for selected insight handles.
4. Re-running unchanged snapshot preserves ranked ordering deterministically.
5. AI assist output supports setup/interpretation and repeats non-causal caveats.

## Out of Scope (Phase 4)

1. Causal inference guarantees beyond statistical association.
2. Unbounded traversal depth or unrestricted search-space exploration.
3. Unified cross-module AI orchestration hardening (Phase 5 scope).
