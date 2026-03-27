# MVP Phase 4 Exec Plan: Root Cause Analysis v1

**Status:** completed  
**Target order:** 4 of 6  
**Agent slot:** A5  
**Predecessor:** `docs/exec-plans/completed/mvp-phase-3-process-mining-ocpn.md`  
**Successor:** `docs/exec-plans/completed/mvp-phase-5-ai-hardening-release.md`  
**Last updated:** 2026-02-22

---

## Objective

Ship a practical, explainable RCA workflow that lifts related-object attributes and ranks candidate root-cause rules with evidence.

## Scope

1. Build RCA request contract with user-defined outcome.
2. Implement neighborhood extraction from object-event-object traversal.
3. Build lifted feature table keyed by anchor object instance.
4. Implement ranking methods: WRAcc, beam-style subgroup expansion, mutual information.
5. Implement insight result contract and evidence payloads.
6. Deliver UI root-cause lab and AI-assisted setup/interpretation.

## Non-Goals

1. Global fixed outcome ontology.
2. Unlimited-depth graph exploration.
3. Causal inference guarantees beyond statistical association.

## Ambiguities Resolved

1. **Extraction backend for MVP:** iterative SQL is the baseline ClickHouse implementation.
2. **Recursive SQL path:** deferred; iterative depth expansion is implemented instead.
3. **Depth controls:** default depth `1`, maximum depth `3`.
4. **Outcome contract:** user provides run-scoped binary outcome definition (`event_type`, optional `object_type`).
5. **Beam search defaults:** max beam width `20`, max rule length `3`.
6. **Coverage floor:** candidate subgroups below `2%` coverage are excluded by default.
7. **High-cardinality handling:** MI enrichment is applied for features at/above configurable cardinality threshold.
8. **Result semantics:** insights are ranked associations with evidence, not guaranteed causation.

## Implementation Steps

1. Define RCA API contract with anchor/time window/depth/outcome/filters.
2. Implement iterative extraction pipeline (seed anchors, bounded-depth expansion, lifted features).
3. Implement WRAcc + beam-style subgroup ranking with MI enrichment.
4. Implement `InsightResult` assembly with evidence summaries and drill-down handles.
5. Implement Root-Cause Lab UI run flow and evidence panel.
6. Implement MVP-thin AI assist endpoints for setup drafting and interpretation.
7. Add fixture-based tests for extraction correctness and ranking stability.

## Acceptance Criteria

1. User can run RCA with explicit outcome definition and bounded depth.
2. Output includes ranked insights with WRAcc-derived score, coverage, and lift context.
3. Evidence drill-down links each insight to supporting traces/aggregates.
4. Re-running same input snapshot produces stable ranking order within deterministic tolerance.
5. UI and AI clearly communicate that results are associative findings.

## Handoff Package to Phase 5

1. RCA API schema and outcome-definition examples.
2. Ranking defaults/knobs (`beam_width`, `max_rule_length`, `min_coverage_ratio`, MI threshold).
3. `InsightResult` schema and Root-Cause Lab rendering expectations.
4. Observed false-positive/false-negative patterns in fixture validation.
5. Evidence assembly traceability (handle encoding -> rerun -> trace payload).

## Risks and Mitigations

1. **Risk:** search-space explosion with wide feature sets.  
   **Mitigation:** enforce depth, beam width, rule length, and coverage floor.
2. **Risk:** users over-interpret correlations as causal truth.  
   **Mitigation:** explicit caveats in API payloads, UI copy, and AI interpretation responses.

## Completion Summary

1. Added dedicated RCA backend domain implementation:
   - contracts: `seer-backend/src/seer_backend/analytics/rca_models.py`
   - iterative extraction repositories (ClickHouse + in-memory): `seer-backend/src/seer_backend/analytics/rca_repository.py`
   - orchestration/scoring/evidence + AI assists: `seer-backend/src/seer_backend/analytics/rca_service.py`
   - RCA API transport: `seer-backend/src/seer_backend/api/root_cause.py`
2. Wired RCA service into app bootstrap and runtime settings:
   - `seer-backend/src/seer_backend/main.py`
   - `seer-backend/src/seer_backend/config/settings.py`
   - `seer-backend/.env.example`
3. Delivered Root-Cause Lab UI (MVP-thin) with:
   - run setup (anchor/time/depth/outcome/filters),
   - ranked insight list with WRAcc/lift/coverage,
   - evidence drill-down,
   - AI-assisted setup + interpretation actions.
4. Added fixture-based Phase 4 tests and fixture data:
   - `seer-backend/tests/fixtures/rca_phase4_orders.json`
   - `seer-backend/tests/test_root_cause_phase4.py`

## Decision Log

1. Kept outcome definition run-scoped and explicit (`event_type`, optional `object_type`) to avoid hidden global semantics.
2. Implemented evidence drill-down with stateless encoded handles instead of server-side session state.
3. Included `missing` feature-state treatment in scoring so sparse lifted features participate in subgroup discovery.
4. Implemented AI assistance as deterministic backend heuristics for MVP-thin behavior (no external model dependency) to preserve local reproducibility.

## Acceptance Evidence

1. `cd seer-backend && uv run ruff check src tests`  
   Result: `All checks passed!`
2. `cd seer-backend && uv run pytest -q`  
   Result: `29 passed`.
3. `cd seer-ui && npm run lint`  
   Result: `eslint` completed with no errors.
4. `cd seer-ui && npm run build`  
   Result: Next.js production build succeeded; `/root-cause` route generated successfully.

## RCA API Contract and Samples

1. `POST /api/v1/root-cause/run`
   - request fields: `anchor_object_type`, `start_at`, `end_at`, `depth`, `outcome`, optional `filters`, plus ranking knobs.
   - response fields: `cohort_size`, `positive_count`, `baseline_rate`, `feature_count`, ranked `insights`, `warnings`, caveat text.
2. `GET /api/v1/root-cause/evidence?handle=...&limit=...`
   - response fields: matched-anchor counts and trace payloads keyed by anchor instance.
3. `POST /api/v1/root-cause/assist/setup`
   - returns suggested outcomes and setup notes.
4. `POST /api/v1/root-cause/assist/interpret`
   - returns summary, caveats, and next-step guidance over ranked insights.

## Ranking Defaults and Tuning Knobs

1. `beam_width`: default `20`, max `50`.
2. `max_rule_length`: default `3`, max `3`.
3. `min_coverage_ratio`: default `0.02`.
4. `mi_cardinality_threshold`: default `8`.
5. `max_insights`: default `25`.

## Known FP/FN Patterns (Fixture Validation)

1. When cohort filters collapse to all-positive/all-negative subsets, WRAcc ranking may return no actionable rules.
2. High-cardinality identity-like features are intentionally excluded from beam expansion and represented via MI enrichment only.
3. Presence-encoded lifted features may surface proxy signals that still require trace-level temporal validation.

## Evidence Assembly Traceability

1. Insight generation builds deterministic rule conditions from lifted per-anchor features.
2. Each insight includes an encoded evidence handle containing request context and rule conditions.
3. Evidence endpoint decodes handle, re-runs bounded extraction, re-applies rule match, and returns supporting trace slices.

## Doc Updates

1. Moved this plan from `docs/exec-plans/active/` to `docs/exec-plans/completed/`.
2. Updated active phase index so Phase 5 is now `in_progress`.
3. Updated roadmap phase references and immediate execution order for Phase 5 start.
4. Added/updated product and module docs for Root-Cause Lab Phase 4 behavior.

## Known Issues

1. FastAPI startup hook deprecation warning (`on_event("startup")`) remains outside Phase 4 scope.
2. RCA AI assist is heuristic MVP-thin behavior and should be unified with broader AI orchestration in Phase 5.

## Next-Phase Starter Context

1. RCA API + service entry points:
   - `seer-backend/src/seer_backend/api/root_cause.py`
   - `seer-backend/src/seer_backend/analytics/rca_service.py`
2. RCA extraction + contracts:
   - `seer-backend/src/seer_backend/analytics/rca_repository.py`
   - `seer-backend/src/seer_backend/analytics/rca_models.py`
3. UI surfaces:
   - `seer-ui/src/components/root-cause-lab.tsx`
   - `seer-ui/src/lib/backend-root-cause.ts`
   - `seer-ui/src/app/root-cause/page.tsx`
4. Phase 4 fixtures/tests:
   - `seer-backend/tests/fixtures/rca_phase4_orders.json`
   - `seer-backend/tests/test_root_cause_phase4.py`
