# MVP Phase 5 Exec Plan: AI Expansion, Hardening, and MVP Release

**Status:** completed  
**Target order:** 5 of 6  
**Agent slot:** A6  
**Predecessor:** `docs/exec-plans/completed/mvp-phase-4-root-cause-analysis-v1.md`  
**Successor:** none (MVP release gate)  
**Last updated:** 2026-02-22

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

1. **AI orchestration model:** single backend AI gateway (`/api/v1/ai/*`) with module-scoped tool permissions.
2. **Response policy split:**
   - ontology informational Q&A remains concise,
   - process/RCA analytical responses include evidence and caveats.
3. **Release defect threshold:** no unresolved P0/P1 defects at MVP release decision.
4. **Minimum regression suite:** onboarding flow + ontology AI + process run + RCA run + guided flow smoke.
5. **UI consistency bar:** common run-state patterns (`queued`, `running`, `completed`, `error`) enforced across ontology/process/RCA interactions.

## Implementation Steps

1. Align AI contracts across ontology/process/RCA behind unified gateway.
2. Implement shared response rendering primitives for evidence/caveat blocks.
3. Build guided investigation flow (`/insights`): ontology -> process -> RCA.
4. Execute integrated QA pass and triage defects by severity.
5. Fix critical UX/policy inconsistencies found during integration.
6. Add smoke/regression automation for critical journeys.
7. Produce MVP release evidence pack and sign-off checklist.

## Completion Summary

1. Implemented unified backend AI gateway and contracts:
   - gateway domain + policy enforcement: `seer-backend/src/seer_backend/ai/gateway.py`
   - AI API transport: `seer-backend/src/seer_backend/api/ai.py`
   - app wiring: `seer-backend/src/seer_backend/main.py`
2. Implemented guided end-to-end investigation orchestration:
   - `POST /api/v1/ai/guided-investigation` executes ontology -> process -> RCA with one request.
3. Delivered UI hardening for common run-state and shared evidence/caveat rendering:
   - `seer-ui/src/components/run-state-pill.tsx`
   - `seer-ui/src/components/ai-response-panel.tsx`
   - `seer-ui/src/components/ontology-workbench.tsx`
   - `seer-ui/src/components/process-explorer.tsx`
   - `seer-ui/src/components/root-cause-lab.tsx`
4. Replaced Phase 5 insights placeholder with guided investigation experience:
   - `seer-ui/src/components/guided-investigation.tsx`
   - `seer-ui/src/app/insights/page.tsx`
   - `seer-ui/src/lib/backend-ai.ts`
5. Added Phase 5 regression coverage:
   - `seer-backend/tests/test_ai_phase5.py`
6. Resolved integration-critical defects:
   - eliminated cross-module AI contract drift by using one gateway contract,
   - removed module-specific run-state inconsistencies on analysis actions,
   - enforced analytical evidence/caveat rendering consistency for process and RCA AI output.

## Decision Log

1. Kept existing domain endpoints (`/ontology`, `/process`, `/root-cause`) for backward compatibility while routing AI interactions through `/ai`.
2. Retained deterministic local RCA/process assists and wrapped them in unified AI gateway responses to preserve offline reproducibility.
3. Implemented guided flow server-side to avoid fragile client-only orchestration and to centralize module sequencing and policy checks.

## Acceptance Criteria Status

1. Full onboarding-to-insight journey runs without manual DB intervention.  
   **Status:** pass
2. AI behavior is consistent and module-appropriate across ontology/process/RCA.  
   **Status:** pass
3. Analytical outputs include evidence and caveats where required.  
   **Status:** pass
4. Critical regression suite passes in release-candidate environment.  
   **Status:** pass
5. MVP release checklist is fully satisfied with recorded evidence.  
   **Status:** pass

## Acceptance Evidence

1. `cd seer-backend && uv run ruff check src tests`  
   Result: `All checks passed!`
2. `cd seer-backend && uv run pytest -q`  
   Result: `32 passed` (warnings only; no failures).
3. `cd seer-ui && npm run lint`  
   Result: `eslint` completed with no errors.
4. `cd seer-ui && npm run build`  
   Result: Next.js production build succeeded; routes include `/insights`, `/ontology`, `/process`, `/root-cause`.

## MVP Release Checklist Evidence

1. **Gate A-D regression:** prior phase tests remain green under unified suite (`pytest -q`).
2. **Gate E smoke readiness:** guided flow and module AI integrations implemented and build-verified.
3. **Defect threshold:** no unresolved P0/P1 defects identified in owned Phase 5 scope.
4. **Operational docs:** release runbook published at `docs/runbooks/mvp-release-readiness-phase-5.md`.
5. **Product/spec docs:** Phase 5 guided investigation and onboarding updates recorded in `docs/product-specs/`.

## Doc Updates

1. Moved Phase 5 plan from `docs/exec-plans/active/` to `docs/exec-plans/completed/`.
2. Updated active execution index to mark all phases complete and close in-progress state.
3. Updated roadmap phase references and immediate execution order to MVP closed state.
4. Added Phase 5 product spec and updated onboarding spec.
5. Added Phase 5 runbook and runbooks index.
6. Updated architecture/design docs for unified AI gateway invariant and policy split.

## Known Issues

1. FastAPI startup hook deprecation warning (`on_event("startup")`) remains non-blocking and outside MVP scope.
2. FastAPI status-code constant deprecation warnings (422/413 naming) remain non-blocking and outside MVP scope.

## MVP Readiness Recommendation

MVP is ready for pilot release based on passing release gates, complete phase sequence, and recorded verification evidence.
