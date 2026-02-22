# MVP Phase 4 Exec Plan: Root Cause Analysis v1

**Status:** planned  
**Target order:** 4 of 6  
**Agent slot:** A5  
**Predecessor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/active/mvp-phase-3-process-mining-ocpn.md`  
**Successor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/active/mvp-phase-5-ai-hardening-release.md`

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

1. **Extraction backend for MVP:** iterative SQL is the only required implementation.
2. **Recursive SQL path:** explicitly deferred from MVP baseline (optional future optimization).
3. **Depth controls:** default depth `1`, maximum depth `3`.
4. **Outcome contract:** user provides a binary outcome definition per run; backend compiles it into bounded query predicates.
5. **Beam search defaults:** max beam width `20`, max rule length `3`.
6. **Coverage floor:** candidate subgroups below `2%` coverage are excluded.
7. **High-cardinality handling:** mutual information is applied only when distinct-value count exceeds configured threshold.
8. **Result semantics:** insights are ranked associations with evidence, not guaranteed causation.

## Implementation Steps

1. Define RCA API contract:
   - anchor object type,
   - time window,
   - traversal depth,
   - outcome definition,
   - optional filter constraints.
2. Implement iterative extraction pipeline:
   - seed anchor cohort,
   - expand through event links by depth,
   - collect candidate features with object-type-aware naming.
3. Implement feature table generation with reproducible row keys.
4. Implement scoring pipeline:
   - WRAcc,
   - beam expansion,
   - MI enrichment for high-cardinality columns.
5. Implement `InsightResult` output assembly with:
   - score/coverage/baseline/segment deltas,
   - evidence traces and aggregate support counts.
6. Implement UI root-cause lab:
   - run configuration,
   - ranked list,
   - drill-down to supporting traces.
7. Implement AI guidance:
   - help draft outcome definitions,
   - summarize top findings and caveats.
8. Add fixture-based tests for extraction correctness and ranking stability.

## Acceptance Criteria

1. User can run RCA with explicit outcome definition and bounded depth.
2. Output includes ranked insights with WRAcc-derived score, coverage, and lift context.
3. Evidence drill-down links each insight to supporting traces/aggregates.
4. Re-running same input snapshot produces stable ranking order within deterministic tolerance.
5. UI and AI clearly communicate that results are associative findings.

## Handoff Package to Phase 5

1. RCA API schema and examples of outcome definitions.
2. Ranking parameter defaults and tuning knobs.
3. InsightResult schema and UI rendering expectations.
4. Known false-positive/false-negative patterns discovered during testing.
5. Traceability docs for how evidence payloads are assembled.

## Risks and Mitigations

1. **Risk:** search-space explosion with wide feature sets.  
   **Mitigation:** enforce depth, beam width, and coverage thresholds.
2. **Risk:** users over-interpret correlations as causal truth.  
   **Mitigation:** add explicit caveats and evidence-first UI presentation.
