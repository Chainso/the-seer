# Post-MVP Exec Plan: Assistant Canvas Shared Display Surfaces

**Status:** in_progress  
**Target order:** post-MVP track 14  
**Agent slot:** AI-ASSISTANT-2  
**Predecessor:** `docs/exec-plans/completed/assistant-conversation-canvas-and-skills.md`  
**Successor:** none  
**Last updated:** 2026-03-08

---

## Objective

Refactor expert drill-down UI so assistant canvas and expert pages share the same result presentation surfaces for:

1. root-cause analysis,
2. object-history timeline + graph,
3. and ontology graph exploration.

The assistant should keep owning conversational input and orchestration, but the displayed investigation surface should be the same UI the user sees on the corresponding expert page.

## Why This Plan Exists

The current assistant canvas architecture is too specialized and too shallow:

1. `ocdfg` is the only artifact with a dedicated renderer.
2. `rca` and `object-timeline` fall back to a generic summary + JSON payload panel.
3. there is no ontology graph canvas artifact type at all.
4. the assistant canvas currently behaves like a second UI system instead of reusing the main expert display surfaces.

The product direction is now explicit:

1. the displayed investigation view should match the main pages,
2. the assistant should differ only in how results are initiated and hosted,
3. and shared components should be extracted so page and canvas stay visually aligned over time.

## Delivery Stance

1. Forward-only refactoring is required.
2. Do not preserve the generic artifact JSON panel as the primary experience for RCA/history/ontology when a real display surface exists.
3. Prefer extracting shared display surfaces from the main pages over creating canvas-only variants.

## Invariants

1. `/assistant` remains the primary AI-first surface and owns conversational input/orchestration.
2. Expert drill-down modules remain read-only in canvas and page contexts.
3. Shared ontology display resolution remains the single source of truth for field/type/state labels.
4. Canvas and page may differ in shell chrome, but not in the core displayed investigation surface.
5. Assistant canvas continues to be tool/artifact-driven through persisted `completion_messages`.

## Legacy Behavior Removal (Intentional)

1. Remove the assumption that non-`ocdfg` assistant artifacts should default to generic summary + raw payload inspection.
2. Remove the coupling between expert result presentation and route-only shells.
3. Remove any need to create canvas-only duplicate layouts for RCA, history timeline, or ontology graph when the main page surface already exists.

Rationale: duplicated display implementations will drift quickly and produce a second-class assistant canvas UX.

## Baseline Validation And Regression Ledger

Recorded on: `2026-03-08`

Controller baseline validation for this execution track:

1. `cd seer-ui && npm run lint`
   - passed
2. `cd seer-ui && npm run build`
   - passed
3. `cd seer-ui && npm run test:contracts`
   - failed only in pre-existing `tests/insights.contract.test.mjs`

Existing unrelated baseline failures:

1. `cd seer-ui && npm run test:contracts`
   - stale contract assertion in `tests/insights.contract.test.mjs` expects an older, simpler tabs markup shape than the shipped `InsightsPanel`

## Architecture Direction

### 1. Shared Display Surfaces, Separate Hosts

Each domain will be split into:

1. page host:
   - route header,
   - route/query-state wiring,
   - expert-only setup/navigation controls
2. assistant canvas host:
   - assistant canvas chrome,
   - artifact handoff,
   - close/update lifecycle
3. shared display surface:
   - the actual result presentation UI shared by both page and canvas

### 2. Domain Controllers Feed Display Surfaces

Each shared display surface should receive normalized, UI-safe inputs from a controller/view-model layer rather than reaching directly into route state or raw artifact payloads.

### 3. Canvas Panel Becomes A Thin Registry Host

`assistant-canvas-panel.tsx` should become a dispatcher/host, not the home of domain-specific UI.

## Phase Map

### Phase 1: RCA Shared Display Surface

Scope:

1. Extract the RCA results display from `process-insights-panel.tsx` into a reusable RCA display surface.
2. Keep route-only setup controls, URL sync, and run initiation in the page host.
3. Add assistant canvas RCA rendering by mounting the same RCA display surface from artifact-driven data.
4. Update RCA-related contract coverage for the new shared-surface architecture.

Exit criteria:

1. RCA result presentation is implemented in one shared surface, not duplicated page/canvas layouts.
2. Assistant canvas no longer shows generic JSON-first RCA output.
3. `/inspector/insights` still renders the expected RCA experience.

Validation:

1. `cd seer-ui && node --test tests/assistant-global.contract.test.mjs tests/insights.contract.test.mjs`
2. `cd seer-ui && npm run lint`
3. `cd seer-ui && npm run build`

### Phase 2: Object History Shared Display Surface

Scope:

1. Extract object-history result display from `object-history-details-panel.tsx` into a reusable shared surface.
2. Keep route-only identity lookup, navigation, and graph time-range controls in the page host.
3. Add assistant canvas history rendering by mounting the same shared surface from history artifacts.

Exit criteria:

1. Object-history timeline + graph display is shared between page and canvas.
2. Assistant history canvas stops using generic artifact fallback.

Validation:

1. `cd seer-ui && node --test tests/assistant-global.contract.test.mjs tests/history.contract.test.mjs`
2. `cd seer-ui && npm run lint`
3. `cd seer-ui && npm run build`

### Phase 3: Ontology Shared Display Surface And Artifact Support

Scope:

1. Introduce a first-class ontology graph assistant artifact type.
2. Extract reusable ontology graph display sections from `ontology-explorer-tabs.tsx`.
3. Mount the shared ontology display surface in both `/ontology/[tab]` and assistant canvas.

Exit criteria:

1. Ontology graph artifact rendering exists in assistant canvas.
2. Ontology graph display is shared between canvas and page.

Validation:

1. `cd seer-ui && node --test tests/assistant-global.contract.test.mjs tests/ontology-display.contract.test.mjs`
2. `cd seer-ui && npm run lint`
3. `cd seer-ui && npm run build`

### Phase 4: Ratification And Archive Readiness

Scope:

1. Update product/design/spec docs to reflect the shared-display-surface model.
2. Ratify artifact coverage for RCA, history, and ontology canvas displays.
3. Update active/completed indexes and archive the plan when all phases are complete.

Exit criteria:

1. Canonical docs reflect the final architecture and UI behavior.
2. Execution indexes are accurate.

Validation:

1. `cd seer-ui && npm run test:contracts`
2. `cd seer-ui && npm run lint`
3. `cd seer-ui && npm run build`

## Progress Checklist

- [x] Phase 1 complete
- [ ] Phase 2 complete
- [ ] Phase 3 complete
- [ ] Phase 4 complete

Current execution state:

- `in_progress`: Phase 2 - Object History shared display surface extraction
- `blocked`: none
- `completed`: Phase 1 - RCA shared display surface extraction

## Phase Progress Notes

### 2026-03-08: Plan Created And Phase 1 Started

1. Confirmed current assistant canvas artifact coverage only specializes `ocdfg`; `rca` and `object-timeline` still fall back to a generic summary/payload panel.
2. Confirmed the desired architectural direction is shared display surfaces between assistant canvas and expert pages, with assistant-specific orchestration staying outside the shared display layer.
3. Recorded early validation baseline:
   - `cd seer-ui && npm run lint` passed
   - `cd seer-ui && npm run build` passed
   - `cd seer-ui && npm run test:contracts` failed only in pre-existing `tests/insights.contract.test.mjs`
4. Began Phase 1 with RCA because it has the clearest data contract and the weakest current assistant-canvas UX.

### 2026-03-08: Phase 1 Delivery Complete

1. Extracted the RCA results presentation into a shared `RootCauseResultsSurface` component.
2. Kept RCA setup controls, URL/query sync, and run initiation inside `process-insights-panel.tsx`.
3. Added `AssistantRootCauseCanvas` so assistant canvas now mounts the same RCA results surface used by `/inspector/insights`.
4. Replaced the assistant canvas RCA generic payload fallback with shared RCA display rendering driven by the existing `artifact.data.run` payload.
5. Updated contract coverage to assert the shared RCA surface boundary for both insights and assistant canvas.
6. Validation passed:
   - `cd seer-ui && node --test tests/assistant-global.contract.test.mjs tests/insights.contract.test.mjs`
   - `cd seer-ui && npm run lint`
   - `cd seer-ui && npm run build`
7. Follow-up validation after updating the stale `insights` contract assertions:
   - `cd seer-ui && npm run test:contracts` passed (`8/8` contract tests)

## Decision Log

1. 2026-03-08: The correct reuse boundary is "same display surface, different control surface" rather than full route parity or canvas-only renderers.
2. 2026-03-08: Assistant canvas will continue to own orchestration/input, while pages keep route/query/setup controls.
3. 2026-03-08: Domain result presentation should be extracted from expert pages and mounted in assistant canvas, not reimplemented inside `assistant-canvas-panel.tsx`.
4. 2026-03-08: Phase 1 establishes the extraction pattern as a shared result surface plus thin page/canvas hosts, rather than a shared route container.

## Risks And Mitigations

1. Risk: extracting shared display surfaces from large route components may create unstable prop boundaries.
   Mitigation: create explicit controller/view-model adapters and keep route state out of shared display components.
2. Risk: assistant artifacts may not yet contain all data needed by page-grade displays.
   Mitigation: normalize artifact payloads through domain-specific canvas model adapters and add typed artifact support where needed.
3. Risk: page and canvas could still drift through host-level styling differences.
   Mitigation: keep the shared display surface responsible for cards, sections, tables, and graph presentation; limit host differences to outer shell chrome only.
