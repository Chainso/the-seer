# MVP Phase 5 Exec Plan: AI Expansion, Hardening, and MVP Release

**Status:** planned  
**Target order:** 5 of 6  
**Agent slot:** A6  
**Predecessor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/active/mvp-phase-4-root-cause-analysis-v1.md`  
**Successor:** none (MVP release gate)

---

## Objective

Unify AI experiences across modules, remove critical defects, and deliver a pilot-ready MVP release package.

## Scope

1. Unify module AI interaction patterns (ontology, process explorer, RCA).
2. Implement end-to-end investigation flow across modules.
3. Harden critical user journeys with smoke and regression coverage.
4. Resolve high-severity defects discovered in integration testing.
5. Produce release checklist evidence and MVP readiness report.

## Non-Goals

1. Major net-new feature modules.
2. Governance/trust-center expansion.
3. Reliability platform overbuild beyond MVP needs.

## Ambiguities Resolved

1. **AI orchestration model:** single backend AI gateway with module-scoped tool permissions.
2. **Response policy split:**
   - informational ontology Q&A can be concise,
   - analytical claims (process/RCA) must include evidence and caveats.
3. **Release defect threshold:** no unresolved P0/P1 defects at MVP release decision.
4. **Minimum regression suite:** onboarding flow + ontology ingest flow + process run + RCA run must pass end-to-end.
5. **UI consistency bar:** common run-state patterns (queued/running/completed/error) across all analysis surfaces.

## Implementation Steps

1. Align AI prompt/tool contracts across ontology/process/RCA modules.
2. Implement shared response rendering primitives for evidence/caveat blocks.
3. Build guided investigation flow:
   - ontology context -> process exploration -> RCA analysis.
4. Execute integrated QA pass and triage defects by severity.
5. Fix P0/P1 defects and highest-impact P2 UX blockers.
6. Add smoke/regression automation for critical journeys.
7. Produce MVP release evidence pack and sign-off checklist.

## Acceptance Criteria

1. Full onboarding-to-insight journey runs without manual DB intervention.
2. AI behavior is consistent and module-appropriate across ontology/process/RCA.
3. Analytical outputs include evidence and caveats where required.
4. Critical regression suite passes in release-candidate environment.
5. MVP release checklist is fully satisfied with recorded evidence.

## Handoff Package (Release)

1. MVP readiness report with gate-by-gate pass evidence.
2. Final known-issues list with severity labels and mitigations.
3. Operational runbook for local/pilot environment startup and verification.
4. Updated docs links for product vision, architecture, and execution history.
5. Recommendation to move completed phase plans into `docs/exec-plans/completed/` after release sign-off.

## Risks and Mitigations

1. **Risk:** inconsistent AI behavior across modules at launch.  
   **Mitigation:** centralize tool permissioning and response policy enforcement.
2. **Risk:** late discovery of cross-module integration defects.  
   **Mitigation:** prioritize end-to-end smoke tests before additional polish work.
