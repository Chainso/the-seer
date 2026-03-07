# Post-MVP Exec Plan: Analytics Run Results Discoverability

**Status:** completed  
**Target order:** post-MVP track 9 (analytics run feedback)  
**Agent slot:** UX-ANALYTICS-1  
**Predecessor:** `docs/exec-plans/completed/responsive-shell-and-mobile-navigation.md`  
**Successor:** `docs/exec-plans/completed/url-backed-analysis-state.md`  
**Last updated:** 2026-03-07

---

## Objective

Make successful analytics runs immediately legible by ensuring users can see what changed after pressing run.

Target behaviors:

1. successful runs do not feel like no-ops,
2. result readiness is communicated without requiring exploratory scrolling,
3. the primary evidence view becomes visible or clearly announced after completion,
4. the same feedback model applies across process mining and root-cause workflows.

## Why Now

Current analytics surfaces place large configuration blocks above the actual result surfaces.

That creates a high-friction failure mode:

1. the user presses `Run`,
2. the backend succeeds,
3. the top of the page appears mostly unchanged,
4. the user has to infer that results may be hidden farther down the page.

This contradicts the product requirement for rapid drill-down into process and RCA evidence.

## Scope

1. Rework result reveal behavior for process mining runs.
2. Rework result reveal behavior for root-cause runs.
3. Add explicit completed-state summaries, jump affordances, or automatic viewport movement after successful runs.
4. Align loading/completed/error feedback patterns across analytics surfaces.
5. Ensure result surfaces expose obvious first actions after completion.

## Non-Goals

1. Changing mining or RCA backend contracts.
2. Reworking the actual graph or insight ranking algorithms.
3. Adding new analytics modules beyond existing process and RCA flows.
4. Solving durable URL state in this plan.

## Legacy Behavior To Remove

1. Do not preserve the current “run succeeded but visible viewport barely changed” behavior.
2. Do not preserve deep result placement without explicit reveal or summary feedback.
3. Do not preserve inconsistent completion semantics between process mining and root-cause screens.

## Implementation Phases

## Phase 1: Shared Run Completion Feedback

**Goal:** define and ship one completion-feedback model for analytics runs.

Deliverables:

1. Shared success-state treatment for analytics forms.
2. Completed-state summary block or sticky status element with run outcome counts and next action.
3. Clear error-state and loading-state alignment with the shared run-state language already described in product specs.

Exit criteria:

1. A successful run causes an obvious visible change at the current viewport.
2. Users can tell whether a run completed, failed, or produced empty results without hunting through the page.

## Phase 2: Result Reveal and Drill-Down Flow

**Goal:** move users directly into the primary result surfaces.

Deliverables:

1. Process mining run transitions users into the OC-DFG result area or an equivalent result summary with jump affordance.
2. Root-cause run transitions users into ranked insights or an equivalent result summary with jump affordance.
3. First-result actions are obvious and route users toward drill-down evidence.

Exit criteria:

1. Successful runs make the primary result surface discoverable within one user step.
2. Empty-result states remain explicit and non-ambiguous.

## Acceptance Criteria

1. Running process mining visibly reveals OC-DFG results or a completed-state jump target.
2. Running RCA visibly reveals ranked insights or a completed-state jump target.
3. Completed runs provide a summary of what was produced, not just a button label change.
4. Empty-result and warning states remain visible and understandable after completion.
5. Playwright validation covers happy-path and empty/low-signal result behavior.

## Risks and Mitigations

1. Risk: automatic scrolling can feel disorienting on long pages.  
   Mitigation: pair movement with a visible completion summary and stable target headings.
2. Risk: results may load progressively, causing premature jumps.  
   Mitigation: gate reveal logic on completion-ready state rather than raw request return.
3. Risk: process mining and RCA need different result emphasis.  
   Mitigation: share the completion pattern, but allow surface-specific primary targets.

## Validation Commands

1. `npm run lint`
2. `npm run build`
3. `npm run test:contracts`
4. Playwright analytics-run checks for process mining and root-cause flows

## Docs Impact

1. `docs/product-specs/process-explorer-phase-3.md`: update result-reveal expectations after mining runs.
2. `docs/product-specs/root-cause-lab-phase-4.md`: update completed-state and result-entry expectations after RCA runs.
3. `DESIGN.md`: update shared run-state behavior if the completion-feedback pattern becomes a design-level invariant.
4. `docs/exec-plans/active/index.md` and `docs/exec-plans/completed/README.md`: archive this plan and update post-MVP plan status references.

## Decision Log

1. 2026-03-07: Treat post-run discoverability as a first-class UX problem rather than a minor polish issue because successful runs currently read as non-events.
2. 2026-03-07: Keep this plan focused on visible run feedback and result reveal, not durable URL state or assistant orchestration.
3. 2026-03-07: Use per-surface summary cards plus jump affordances instead of scroll-only reveal so completion remains legible even when result sections are large.

## Progress Log

1. 2026-03-07: Added visible completion summaries and jump affordances for both Process Mining and Root-Cause flows.
2. 2026-03-07: Expanded completion signatures so repeat runs with different inputs still surface the completion summary instead of reading as a no-op.
3. 2026-03-07: Validated process mining and RCA happy-path run/reload behavior in Playwright plus clean `npm run lint` and `npm run build` gates.

## Progress Tracking

- [x] Phase 1 complete
- [x] Phase 2 complete

Current status:

1. Completed.
2. Shared analytics completion feedback and result-reveal behavior are landed and ratified.
