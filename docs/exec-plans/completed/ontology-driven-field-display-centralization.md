# Post-MVP Exec Plan: Ontology-Driven Field Display Centralization

**Status:** completed  
**Target order:** post-MVP track 3 (completed)  
**Agent slot:** UX-R3  
**Predecessor:** `docs/exec-plans/completed/post-mvp-ontology-process-readonly-adaptation.md`  
**Successor:** TBD  
**Last updated:** 2026-02-28

---

## Objective

Centralize all field-label and field-value display logic behind one ontology-driven resolver so every page renders keys, values, states, and filter fields consistently.

Compatibility stance: this effort does **not** preserve legacy per-page display quirks for backward compatibility; it establishes a single forward contract.

---

## Problem Statement

Field display logic is currently duplicated and diverging across pages:

1. `history-panel` contains local key aliasing, state token mapping, payload summarization, and type/operator inference.
2. `process-insights-panel` re-implements type/operator inference, event/filter prettification, and anchor-field label mapping.
3. `process-mining-panel` and `object-activity-panel` each keep local ontology naming fallbacks.
4. Multiple pages define their own `iriLocalName`, ontology-name preference rules, and fallback formatting.

This creates inconsistent UX and makes ontology-driven improvements expensive to roll out.

---

## Core Product Invariant (Target)

After this plan is completed and docs are ratified:

1. **All user-visible field display decisions in Seer UI must be resolved via a shared ontology display layer.**
2. **Page-level components may configure context, but may not implement custom field-label/state-label fallback chains.**
3. **If ontology metadata is available, it is the first source of truth for field labels and state value labels.**

---

## Scope

1. Create a shared UI display resolver for:
   - object type labels,
   - event type labels,
   - field labels,
   - state value labels,
   - compact `Key · Value` summary formatting,
   - field-kind/operator compatibility logic.
2. Migrate inspector pages that currently duplicate this logic:
   - `history-panel`,
   - `process-insights-panel`,
   - `process-mining-panel`,
   - `object-activity-panel` (label normalization alignment).
3. Add tests that lock shared behavior and prevent re-fragmentation.
4. Ratify documentation updates across architecture/design/product/plan docs after implementation.

## Non-Goals

1. Changing backend contracts purely for this centralization.
2. Introducing ontology mutation capabilities.
3. Reworking unrelated visual styling.
4. Preserving page-local legacy display behavior when it conflicts with the shared resolver contract.

---

## Target Design

Introduce a shared module in `seer-ui/app/lib/ontology-display/`:

1. `catalog.ts`
   - builds memoized indexes from `OntologyGraph`:
   - concept label lookup,
   - object model metadata,
   - property alias maps,
   - state token maps,
   - event type display maps.
2. `resolver.ts`
   - exposes stable APIs:
   - `displayObjectType(...)`,
   - `displayEventType(...)`,
   - `displayFieldLabel(...)`,
   - `displayFieldValue(...)`,
   - `summarizePayload(...)`,
   - `summarizeObjectRef(...)`,
   - `fieldKindForKey(...)`,
   - `operatorOptionsForField(...)`.
3. `use-ontology-display.ts`
   - hook backed by `OntologyGraphProvider` so pages reuse one graph-derived display catalog.

Design rule: page components pass context (`objectType`, `eventType`, field key, value) but not display policy.

---

## Phase Plan

## Phase 1: Shared Display Layer Foundation

**Goal:** introduce the shared ontology display catalog + resolver as the new canonical display contract.

Deliverables:

1. New shared module (`ontology-display`) with typed APIs.
2. Pure-function unit tests for fallback precedence and label normalization.
3. Codemod-level extraction of duplicated utility logic (`iriLocalName`, normalization, type-kind inference).

Exit criteria:

1. Shared module covers all currently duplicated display decisions.
2. Tests validate deterministic, documented resolver rules (ontology-first labels, consistent fallback behavior, normalized operator support).

## Phase 2: History Panel Migration

**Goal:** make history rendering consume the shared resolver.

Deliverables:

1. Replace local field/state label resolution in `history-panel`.
2. Replace local payload/reference summarizers with shared helpers.
3. Align history rendering to shared resolver behavior even where it differs from legacy page-local formatting quirks.

Exit criteria:

1. No page-local fallback chain remains in `history-panel`.
2. Existing history contract tests pass; add targeted tests for resolved labels.

## Phase 3: Process Insights Migration

**Goal:** remove duplicate field/operator/event-display logic from root-cause insights panel.

Deliverables:

1. Replace local `prettyEventType`, `prettyFilterField`, field-kind inference, and operator normalization with shared resolver APIs.
2. Reuse shared anchor field-label resolution from ontology metadata.
3. Ensure suggestion/evidence rendering uses the same label source as history.

Exit criteria:

1. Filter field labels and event labels align with shared ontology display behavior.
2. No duplicated type-token/operator rules in `process-insights-panel`.

## Phase 4: Remaining Inspector Alignment

**Goal:** align remaining inspector views to shared naming/display behavior.

Deliverables:

1. Migrate `process-mining-panel` naming fallbacks to shared APIs.
2. Migrate `object-activity-panel` naming fallbacks to shared APIs.
3. Validate no component-level `iriLocalName`/ontology-name fallback logic remains for field display concerns.

Exit criteria:

1. Inspector pages produce consistent labels for same ontology concept across views.

## Phase 5: Regression Guardrails

**Goal:** prevent drift back to page-specific display logic.

Deliverables:

1. Add tests in `seer-ui/tests` asserting key pages import/use shared display module.
2. Add focused resolver test vectors for alias rewrites and state token mapping.
3. Add lint/static check (or contract test) to flag duplicate local display utilities in inspector pages.

Exit criteria:

1. CI fails if field display logic is re-duplicated in page components.

## Phase 6: Documentation Ratification (Required)

**Goal:** encode invariant and implementation truth across canonical docs after code lands.

Deliverables:

1. `VISION.md`: add ontology-driven field display consistency expectation to product scope/UX intent.
2. `DESIGN.md`: add shared ontology display-layer design theme.
3. `ARCHITECTURE.md`: add invariant for centralized field display policy in `seer-ui`.
4. `docs/product-specs/history-inspector-phase-3a.md`: reference shared resolver as mandatory source for field/state labels.
5. `docs/exec-plans/completed/post-mvp-ontology-process-readonly-adaptation.md`: record migration completion and handoff references.
6. Move this plan to `docs/exec-plans/completed/` with acceptance evidence once complete.

Exit criteria:

1. Product/design/architecture/plan docs are mutually consistent about this invariant.
2. Index files remain accurate after plan status transition.

---

## Acceptance Criteria

1. Same field key/value pair renders the same label/value formatting across history and insights flows for the same ontology context.
2. State-like values resolve through ontology state labels consistently wherever shown.
3. Field operator availability is determined by one shared field-kind inference path.
4. Inspector pages no longer carry independent fallback chains for field display logic.
5. Documentation updates ratify this behavior as a core invariant.

---

## Risks and Mitigations

1. Risk: user-visible label/output differences after removing legacy page-local behavior.  
   Mitigation: publish explicit display rules in docs/specs and align all pages simultaneously through shared resolver.
2. Risk: resolver becomes overly coupled to one panel’s needs.  
   Mitigation: keep resolver API context-driven and component-agnostic.
3. Risk: docs drift if implementation lands in slices.  
   Mitigation: make Phase 6 mandatory for completion and include doc checklist in PR template.

---

## Progress Tracking

- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete
- [x] Phase 4 complete
- [x] Phase 5 complete
- [x] Phase 6 complete

## Progress / Decision Log

### 2026-02-28

1. Delivered Phase 1 shared ontology display foundation in `seer-ui/app/lib/ontology-display/`:
   - `catalog.ts` (graph-derived display catalog/indexes),
   - `resolver.ts` (canonical object/event/field/value/summary/operator APIs),
   - `use-ontology-display.ts` and `index.ts` (hook + barrel export contract).
2. Added Phase 1 contract coverage in `seer-ui/tests/ontology-display.contract.test.mjs` for:
   - ontology-first object/event labels,
   - centralized field label and state value rendering,
   - summary formatting,
   - field-kind and operator compatibility normalization.
3. Validation evidence:
   - `npm run test:contracts`: `tests/ontology-display.contract.test.mjs` passes; suite currently has one unrelated pre-existing failure in `tests/change-intelligence.contract.test.mjs` (`assert.ok(assistantApi.includes("/assistant/generate"))`).
   - `npm run lint`: no errors in `ontology-display` files; command fails on pre-existing unrelated inspector/ontology files.
4. Decision: treat Phase 1 as complete because shared resolver APIs and contract tests are implemented and passing; defer panel migrations to Phase 2+.
5. Delivered Phase 2 history-panel migration to shared ontology display resolver:
   - `seer-ui/app/components/inspector/history-panel.tsx` now uses `useOntologyDisplay()` for object/event labels, field labels, state value mapping, payload/object-ref summaries, and field-kind/operator normalization (`profile: "history"`).
   - `seer-ui/app/lib/ontology-display/catalog.ts` now exposes `canonicalFieldKeys` on `OntologyDisplayObjectModel` so history filters can source canonical object properties from the shared display catalog.
   - `seer-ui/tests/history.contract.test.mjs` adds a targeted contract assertion that history panel consumes shared ontology display resolver APIs.
6. Validation evidence for Phase 2:
   - `cd seer-ui && npm run test:contracts`: `tests/history.contract.test.mjs` and `tests/ontology-display.contract.test.mjs` pass; suite still has one unrelated pre-existing failure in `tests/change-intelligence.contract.test.mjs`.
   - `cd seer-ui && node --test tests/history.contract.test.mjs tests/ontology-display.contract.test.mjs`: pass.
   - `cd seer-ui && npm run lint`: fails on pre-existing unrelated files (`bpmn-graph.tsx`, `object-activity-panel.tsx`, ontology components), no new history-panel errors.
   - `cd seer-ui && npm run build`: fails on pre-existing unrelated TypeScript error in `app/components/inspector/bpmn-graph.tsx` (`ElkEdgeData` vs `EdgeProps` constraint).
7. Decision: mark Phase 2 complete; keep Phase 3+ unchecked and unchanged.
8. Delivered Phase 3 process-insights migration to shared ontology display resolver:
   - `seer-ui/app/components/inspector/process-insights-panel.tsx` now uses `useOntologyDisplay()` for event type labels, filter-field labels (including `anchor.*`, `event.*`, and `object_type.count.*`), filter field-kind/operator compatibility normalization (`profile: "insights"`), and evidence anchor object type labels.
   - Removed page-local display duplication in process insights (`prettyEventType`, `prettyFilterField`, local field-kind token inference, and local operator compatibility/default/normalization logic) in favor of shared resolver APIs.
   - Anchor field header labels now resolve through shared ontology field label resolution rather than local property-name mapping.
9. Added Phase 3 contract coverage:
   - `seer-ui/tests/insights.contract.test.mjs` now asserts process insights imports and uses the shared ontology display resolver contract methods.
10. Validation evidence for Phase 3:
   - `cd seer-ui && npm run test:contracts`: `tests/insights.contract.test.mjs` and `tests/ontology-display.contract.test.mjs` pass; suite still has one unrelated pre-existing failure in `tests/change-intelligence.contract.test.mjs`.
   - `cd seer-ui && node --test tests/insights.contract.test.mjs tests/ontology-display.contract.test.mjs`: pass.
   - `cd seer-ui && npm run lint`: fails on pre-existing unrelated files (`bpmn-graph.tsx`, `object-activity-panel.tsx`, ontology components), with no new process-insights or ontology-display lint errors introduced by Phase 3.
   - `cd seer-ui && npm run build`: fails on pre-existing unrelated TypeScript error in `app/components/inspector/bpmn-graph.tsx` (`ElkEdgeData` vs `EdgeProps` constraint).
11. Decision: mark Phase 3 complete after resolver migration + contract coverage + required focused validation; keep Phase 4+ unchecked.
12. Delivered Phase 4 remaining inspector alignment to shared ontology display resolver:
   - `seer-ui/app/components/inspector/process-mining-panel.tsx` now uses `useOntologyDisplay()` for object-model options and event/object naming across graph legend + node inspector, removing local ontology fetch and local `iriLocalName`/`ontologyNodeName` fallback helpers.
   - `seer-ui/app/components/inspector/object-activity-panel.tsx` now uses `useOntologyDisplay()` for model options, timeline model labels, timeline activity labels, and graph activity/model lookups, removing local `getNodesByLabel` naming path and local `resolveActivityName` fallback.
   - `seer-ui/tests/insights.contract.test.mjs` now includes focused contract checks that both `process-mining-panel` and `object-activity-panel` consume shared ontology display resolver APIs.
13. Validation evidence for Phase 4:
   - `cd seer-ui && node --test tests/history.contract.test.mjs tests/insights.contract.test.mjs tests/ontology-display.contract.test.mjs`: pass.
   - `cd seer-ui && npm run test:contracts`: `tests/history.contract.test.mjs`, `tests/insights.contract.test.mjs`, and `tests/ontology-display.contract.test.mjs` pass; suite still has one unrelated pre-existing failure in `tests/change-intelligence.contract.test.mjs`.
   - `cd seer-ui && npm run lint`: fails on pre-existing unrelated files (`bpmn-graph.tsx`, ontology editor components), with no new process-mining/object-activity lint errors introduced by Phase 4.
   - `cd seer-ui && npm run build`: fails on pre-existing unrelated TypeScript error in `app/components/inspector/bpmn-graph.tsx` (`ElkEdgeData` vs `EdgeProps` constraint).
14. Decision: mark Phase 4 complete after inspector resolver alignment + focused contract coverage + required validation evidence; keep Phases 5-6 unchecked.
15. Delivered Phase 5 regression guardrails to prevent field-display logic re-fragmentation:
   - added `seer-ui/tests/ontology-display-guardrails.contract.test.mjs` with static contract checks that migrated inspector panels (`history-panel`, `process-insights-panel`, `process-mining-panel`, `object-activity-panel`) continue importing/using shared ontology-display APIs.
   - added guardrail assertions that local pretty display helper patterns (`prettyEventType`, `prettyFilterField`, `prettyFieldLabel`) are not reintroduced in migrated panels.
   - added guardrail assertions that cleaned panels (`history-panel`, `process-mining-panel`, `object-activity-panel`) do not reintroduce local `iriLocalName`/`ontologyNodeName` fallback-chain helper definitions.
16. Extended shared resolver contract vectors in `seer-ui/tests/ontology-display.contract.test.mjs`:
   - alias rewrite coverage for cross-alias field labels (`sales_order_number`/`order_number`),
   - state token mapping coverage for canonical and alias-like state values (`state_order_pending`, `order_pending`).
17. Validation evidence for Phase 5:
   - `cd seer-ui && node --test tests/ontology-display-guardrails.contract.test.mjs tests/ontology-display.contract.test.mjs`: pass.
   - `cd seer-ui && npm run test:contracts`: passes `tests/history.contract.test.mjs`, `tests/insights.contract.test.mjs`, `tests/ontology-display-guardrails.contract.test.mjs`, and `tests/ontology-display.contract.test.mjs`; suite still has one unrelated pre-existing failure in `tests/change-intelligence.contract.test.mjs` (`assert.ok(assistantApi.includes("/assistant/generate"))`).
18. Decision: mark Phase 5 complete after guardrails + resolver contract extensions + required validation evidence; keep Phase 6 unchecked for final documentation ratification.
19. Delivered Phase 6 documentation ratification updates to canonical docs:
   - `VISION.md` adds product-level ontology-driven display consistency requirement.
   - `DESIGN.md` adds shared ontology display layer as a design theme.
   - `ARCHITECTURE.md` adds invariant centralizing field/state/value display policy in `seer-ui/app/lib/ontology-display/`.
   - `docs/product-specs/history-inspector-phase-3a.md` makes shared resolver mandatory for field/state label source-of-truth.
20. Updated execution-plan lifecycle docs for completion handoff:
   - added handoff note in `docs/exec-plans/completed/post-mvp-ontology-process-readonly-adaptation.md`,
   - moved this plan to `docs/exec-plans/completed/ontology-driven-field-display-centralization.md`,
   - updated `docs/exec-plans/active/index.md` and `docs/exec-plans/completed/README.md` for accurate status/indexing.
21. Validation evidence for Phase 6:
   - markdown/index sanity checks: confirmed moved-plan presence under `docs/exec-plans/completed/`, no remaining `active/ontology-driven-field-display-centralization.md` references, and updated listing/state entries in `docs/exec-plans/active/index.md`, `docs/exec-plans/completed/README.md`, and `docs/exec-plans/completed/post-mvp-ontology-process-readonly-adaptation.md`.
   - `cd seer-ui && npm run test:contracts`: passes `tests/history.contract.test.mjs`, `tests/insights.contract.test.mjs`, `tests/ontology-display-guardrails.contract.test.mjs`, and `tests/ontology-display.contract.test.mjs`; unchanged pre-existing failure remains in `tests/change-intelligence.contract.test.mjs`.
22. Decision: mark Phase 6 complete and close this plan after documentation ratification, index synchronization, and final validation evidence capture.
23. 2026-02-28: Adaptive lifecycle follow-up was completed in `docs/exec-plans/completed/adaptive-lifecycle-label-display.md`, locking explicit lifecycle labels in cross-object explorer contexts, plain/default lifecycle labels in object-local history contexts, and removal of hard-coded alias rewrite tables from the shared ontology display catalog.

Current execution state:

- `completed`: Phases 1-6 complete on 2026-02-28.
