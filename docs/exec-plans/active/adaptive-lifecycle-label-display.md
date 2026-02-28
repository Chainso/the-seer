# Post-MVP Exec Plan: Adaptive Lifecycle Label Display Modes

**Status:** in_progress  
**Target order:** post-MVP track 4 (focused UX polish)  
**Agent slot:** UX-R4  
**Predecessor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/ontology-driven-field-display-centralization.md`  
**Successor:** TBD  
**Last updated:** 2026-02-28

---

## Objective

Implement adaptive lifecycle labeling for `State` and `Transition` concepts so display mode changes by context:

1. Cross-object contexts (for example, Ontology Explorer) use explicit labels:
   - `State` -> `<ObjectName> <State>`
   - `Transition` -> `<Transition> <ObjectName>`
2. Object-local contexts (for example, Object Event History timeline/details) keep plain labels.

---

## Scope

1. Extend shared ontology display layer with explicit lifecycle label modes.
2. Apply explicit lifecycle mode in Ontology Explorer surfaces (catalog, inspector relationship lists, graph node titles).
3. Preserve plain mode for object-local history flows.
4. Add targeted tests to prevent regressions.
5. Update docs/plan progress and handoff references.

## Non-Goals

1. Reworking non-lifecycle naming patterns outside this feature.
2. Broad UI redesign.
3. Backend contract changes.

---

## Baseline Failure Ledger (Pre-existing, not introduced by this plan)

1. `cd seer-ui && npm run test:contracts` has existing failure in `tests/change-intelligence.contract.test.mjs`.
2. `cd seer-ui && npm run lint` has existing failures in files outside this scope (for example `bpmn-graph.tsx`, ontology editor files).
3. `cd seer-ui && npm run build` has existing TypeScript failure in `app/components/inspector/bpmn-graph.tsx`.

These are treated as pre-existing until independently resolved.

---

## Phase Plan

## Phase 1: Shared Resolver Adaptive Mode

**Goal:** add lifecycle mode-aware naming to shared ontology display resolver/catalog.

Deliverables:

1. Catalog indexes owner object for state/transition concepts.
2. Resolver APIs support plain vs explicit lifecycle modes.
3. Contract tests cover:
   - state explicit mode format,
   - transition explicit mode format,
   - plain mode preservation.

Exit criteria:

1. Resolver can deterministically render lifecycle names in both modes.
2. Existing consumers remain backward-compatible with plain mode defaults.

## Phase 2: Ontology Explorer Integration

**Goal:** use explicit lifecycle mode in cross-object Ontology Explorer surfaces.

Deliverables:

1. Explorer catalog uses explicit lifecycle labels.
2. Explorer inspector relation lists use explicit lifecycle labels.
3. Ontology map node display (in explorer) uses explicit lifecycle labels.

Exit criteria:

1. State/transition labels in explorer are object-qualified.
2. Object-local history timeline/details remain plain labels.

## Phase 3: Validation, Docs, and Closeout

**Goal:** lock behavior with tests and update execution docs.

Deliverables:

1. Update or add contract tests for adaptive lifecycle mode behavior.
2. Record completion/progress evidence in this plan and active index.
3. Add handoff note in active read-only adaptation plan.

Exit criteria:

1. Phases 1-3 complete and documented with validation outputs.
2. Plan is ready to move to `completed/`.

---

## Progress Tracking

- [x] Phase 1 complete
- [ ] Phase 2 complete
- [ ] Phase 3 complete

Current execution state:

- `in_progress`: Phase 2 pending (Phase 1 shared resolver adaptive mode complete and validated on 2026-02-28).

## Progress / Decision Log

1. 2026-02-28: Plan created with explicit dual-mode lifecycle labeling rule and pre-existing failure ledger to reduce validation ambiguity.
2. 2026-02-28: Phase 1 completed by extending ontology display catalog with deterministic state/transition owner-object indexes and adding resolver concept/node APIs with opt-in `explicit` lifecycle label mode.
3. 2026-02-28: Decision - keep `plain` lifecycle label mode as default for all existing resolver consumers to preserve current object-local display behavior until Phase 2 integration explicitly opts into qualified lifecycle labels.
