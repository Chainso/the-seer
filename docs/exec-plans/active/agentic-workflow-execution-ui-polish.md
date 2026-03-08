# Post-MVP Exec Plan: Agentic Workflow Execution UI Polish

**Status:** in_progress  
**Target order:** post-MVP track 13  
**Agent slot:** AGENT-RUNTIME-UI-2  
**Predecessor:** `docs/exec-plans/completed/managed-agent-runtime-and-agentic-workflows.md`  
**Successor:** none  
**Last updated:** 2026-03-08

---

## Objective

Polish the agentic workflow execution list/detail experience so it feels like Seer's existing ontology/history inspector surfaces rather than a raw admin console.

This track should improve:

1. transcript scanability,
2. page hierarchy and information density,
3. ontology-first presentation,
4. drill-in interaction patterns,
5. and filter ergonomics.

## Problem Statement

The current execution UI is now functionally correct:

1. the execution list loads without `user_id`,
2. workflow filtering is ontology-backed,
3. and the detail page resolves workflow/action/event labels through the shared ontology display layer.

But the experience still lags the event/history surfaces:

1. transcript entries are too debug-heavy and repetitive,
2. the detail page hierarchy is transcript-dominant and weakly oriented,
3. raw identifiers still carry too much visual weight,
4. list/detail interactions are less fluid than the rest of the inspector,
5. and the filter panel still reads more like a query form than an inspector surface.

## Compatibility Stance

1. Backward compatibility is not a requirement for this phase.
2. If a cleaner, more inspectable run experience requires changing the current list/detail layout, prefer the better current UX.
3. Raw identifiers and control-plane metadata should be retained only as supporting detail, not as the primary presentation.

## Scope

1. Refine the execution list surface at `/inspector/agentic-workflows`.
2. Refine the execution detail surface at `/inspector/agentic-workflows/[executionId]`.
3. Improve transcript presentation and run-orientation hierarchy.
4. Reduce visible raw URI/ID emphasis while keeping identifiers available as supporting detail.
5. Align interaction patterns with existing history/object inspector behavior.
6. Update any user-facing specs/docs if the delivered behavior meaningfully changes.

## Non-Goals

1. Any new runtime, transcript, or action orchestration backend contract work.
2. Changes to ontology definitions or action execution semantics.
3. Final managed-agent activation/editor UX.
4. Pause/resume/revoke or approvals UX.
5. Introducing a brand-new design system just for this surface.

## Why This Phase Exists

1. The runtime/execution model is now landed and documented.
2. The remaining gap is UX quality, not architecture.
3. Seer already has stronger inspector patterns in object history and related ontology-aware surfaces.
4. Reusing those patterns should make workflow runs easier to inspect, explain, and debug.

## Planning Lock Decisions (2026-03-08)

1. This phase is UI-first and should avoid backend churn unless a tiny read-shape change is required to support a materially better inspector experience.
2. The object-history display surfaces are the strongest existing precedent for hierarchy, scanability, and ontology-first presentation.
3. Transcript presentation should prioritize legible summaries, grouping, and highlights before raw payload detail.
4. Execution list rows should feel browsable, not like a static table with a separate action column.
5. Raw identifiers remain useful, but must move into secondary/supporting detail.

## Acceptance Criteria

1. The execution detail page gives the user immediate orientation before they start reading raw transcript entries.
2. Transcript presentation is more scannable than the current per-message debug-card feed.
3. Execution list/detail surfaces reduce first-class exposure of raw URIs and full IDs.
4. The execution list interaction feels consistent with other inspector browse/drill flows.
5. Filter controls feel more intentional and inspector-like than the current flat query form.
6. Frontend lint/build/contracts remain green after the changes.

## Risks and Mitigations

1. Risk: polishing the page turns into a full redesign.  
   Mitigation: stay anchored to existing history/object inspector patterns rather than inventing a new visual language.
2. Risk: transcript UI becomes prettier but less truthful.  
   Mitigation: keep raw payload/identifier detail available through secondary disclosure rather than removing it.
3. Risk: interaction changes make debugging harder for engineers.  
   Mitigation: preserve access to raw IDs/payloads, but demote them visually.

## Validation Commands

Baseline / phase validation:

1. `cd seer-ui && npm run lint`
2. `cd seer-ui && npm run build`
3. `cd seer-ui && npm run test:contracts`

Review / coherence:

1. `rg -n "Workflow Runs|Transcript|Run Summary|Produced Events|Open|action_uri|action_id|event_id|user_id" seer-ui/app/components/inspector/agentic-workflow-execution-panel.tsx seer-ui/app/components/inspector/agentic-workflow-execution-details-panel.tsx`
2. Manual comparison against `seer-ui/app/components/inspector/object-history-display-surface.tsx`, `seer-ui/app/components/inspector/object-history-timeline.tsx`, and `seer-ui/app/components/inspector/history-panel.tsx`

## Docs Impact

Immediate:

1. `docs/exec-plans/active/agentic-workflow-execution-ui-polish.md`
2. `docs/exec-plans/active/index.md`

Expected if behavior shifts materially:

1. `docs/product-specs/managed-agent-controls-and-approvals.md`
2. `docs/product-specs/managed-agentic-workflows.md`
3. `docs/exec-plans/completed/README.md`

## Implementation Phases

## Phase 1: Plan Lock + Baseline Validation

**Goal:** capture the UX-quality scope precisely and verify the current frontend baseline before editing.

Deliverables:

1. active execution plan opened with explicit findings and constraints,
2. clean frontend validation ledger,
3. clear phase boundary for implementation worker handoff.

Exit criteria:

1. baseline validation is clean enough to proceed,
2. the plan documents the specific UI quality gaps to address.

## Phase 2: Execution Surface Polish

**Goal:** improve the run list/detail experience to match Seer's inspector quality bar.

Deliverables:

1. more legible execution list hierarchy and interaction,
2. more scan-friendly transcript presentation,
3. stronger run-orientation summary/detail hierarchy,
4. reduced raw identifier prominence,
5. updated UI tests/contracts as needed.

Exit criteria:

1. the workflow list feels browseable rather than admin-table-first,
2. the detail page no longer feels transcript-only or debug-led,
3. ontology-aware presentation is primary and raw identifiers are supporting detail.

Validation:

1. `cd seer-ui && npm run lint`
2. `cd seer-ui && npm run build`
3. `cd seer-ui && npm run test:contracts`

## Phase 3: Final Ratification + Archive

**Goal:** update any affected product-spec wording, then archive the plan when the UI polish lands.

Deliverables:

1. specs updated if the delivered surface meaningfully shifts,
2. active/completed plan indexes updated coherently,
3. plan archived to `docs/exec-plans/completed/`.

Exit criteria:

1. active/completed indexes are coherent,
2. docs/specs match the delivered UI,
3. plan is archived out of `active/`.

## Decision Log

1. 2026-03-08: This track is a follow-on UI-quality phase, not another runtime-architecture phase.
2. 2026-03-08: Object-history surfaces are the primary interaction/design precedent for this work.
3. 2026-03-08: Transcript truthfulness must be preserved while improving scanability and hierarchy.
4. 2026-03-08: Phase 2 shifts the execution list and detail surfaces away from admin-table-first presentation toward browseable inspector cards and timeline-style transcript entries.
5. 2026-03-08: Raw workflow, execution, and event identifiers remain available through supporting-detail disclosure instead of occupying primary summary space.

## Progress Log

1. 2026-03-08: Opened the follow-on execution UI polish plan after review of the delivered workflow run surfaces showed the remaining gap was presentation/interaction quality rather than runtime contract correctness.
2. 2026-03-08: Frontend baseline validation before Phase 2 is clean enough to proceed: `cd seer-ui && npm run lint` passed, `cd seer-ui && npm run build` passed, and `cd seer-ui && npm run test:contracts` passed (`10 passed`).
3. 2026-03-08: Reworked the execution list into direct browseable inspector cards, reshaped the detail page around a summary-first execution chain, and converted transcript/event rendering toward inspector-style cards with supporting-detail disclosure for raw payloads and identifiers.

## Progress Tracking

- [x] Phase 1 plan lock + baseline validation
- [x] Phase 2 execution surface polish
- [ ] Phase 3 final ratification + archive

Current execution state:

1. `completed`: Phase 1 plan lock + baseline validation.
2. `completed`: Phase 2 execution surface polish.
3. `pending`: Phase 3 final ratification + archive follows after the polish phase lands.
