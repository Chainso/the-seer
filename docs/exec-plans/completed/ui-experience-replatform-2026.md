# Post-MVP Exec Plan: UI Experience Replatform on `seer-ui` Using `seer-ui-old` Patterns

**Status:** completed  
**Target order:** post-MVP track 1  
**Agent slot:** UX-R1  
**Predecessor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-5-ai-hardening-release.md`  
**Successor:** TBD (post-MVP plan chain)  
**Last updated:** 2026-02-22

---

## Objective

Bring the current `seer-ui` experience closer to `seer-ui-old` while preserving current architecture and backend contracts.

The implementation strategy is to keep `seer-ui` as the canonical app and port proven UX patterns from `seer-ui-old` in controlled phases.

## Why This Plan Exists

The current UI is functionally aligned with MVP scope, but the interaction quality and information density are significantly lower than the prior UI attempt.

Repository baseline comparison (2026-02-22):

1. `seer-ui` has ~34 files and ~2.1k TS/TSX LOC.
2. `seer-ui-old` has ~101 files and ~16.7k TS/TSX LOC.
3. `seer-ui-old` contains richer navigation, ontology graph exploration controls, assistant mission-control patterns, and inspector workflows.
4. `seer-ui-old` uses legacy endpoint contracts that do not match the current backend API.

## Architectural Guardrails (Must Hold)

1. `seer-ui` remains the production frontend package and route root.
2. Next.js App Router and create-next-app conventions remain intact.
3. Ontology UX remains read-only in Seer UI.
4. Backend remains contract owner; UI does not bypass backend boundaries.
5. AI interactions remain routed through the unified `/api/v1/ai/*` gateway for module-scoped policy behavior.
6. Any invariant changes must be reflected in `VISION.md` and `ARCHITECTURE.md` in the same change.

## Scope

1. Replatform layout/navigation/visual system from old UI patterns into `seer-ui`.
2. Introduce an adapter-driven frontend data layer that maps current backend contracts into richer view models.
3. Rebuild ontology/process/root-cause/insights experiences with higher interaction quality.
4. Reuse safe utilities from `seer-ui-old` where compatible (`performance-budget`, `security-redaction`, selected UI primitives).
5. Add contract/integration/E2E checks for all replatformed flows.
6. Produce rollout and rollback guidance for the replatform release.

## Non-Goals

1. Full codebase swap to `seer-ui-old`.
2. Reintroducing ontology authoring or publish workflows in Seer UI.
3. Implementing backend compatibility shims for every legacy `seer-ui-old` endpoint.
4. Broad backend domain expansion solely to mimic old UI screens.
5. Introducing new governance/trust-center modules in this track.
6. Recreating legacy backend contracts for Change Intelligence and legacy Object Store.
7. Porting Change Intelligence UI (`/changes`) into the post-MVP replatform track.
8. Porting any ontology editing features from `seer-ui-old`, including create/edit/delete/publish controls.

## Starting Contract Delta

Legacy frontend contracts currently referenced by `seer-ui-old`:

1. `/ontology/graph`, `/ontology/object-models`, `/ontology/actions`, `/ontology/signals`, `/ontology/states`, `/ontology/transitions`, `/ontology/event-triggers`, `/ontology/local-ontologies`, `/ontology/*types`
2. `/process-mining/ocpn`
3. `/assistant/generate`
4. `/objects/query`, `/objects/summary`, `/objects/timeline`, `/objects/graph`
5. `/analytics/ontology/flows`, `/analytics/ontology/durations`
6. `/changes/semantic-diff`

Current canonical contracts in `seer-backend`:

1. `/api/v1/health`
2. `/api/v1/ontology/current`, `/api/v1/ontology/concepts`, `/api/v1/ontology/concept-detail`, `/api/v1/ontology/query`, `/api/v1/ontology/copilot`
3. `/api/v1/history/events/ingest`, `/api/v1/history/events`, `/api/v1/history/objects/timeline`, `/api/v1/history/relations`
4. `/api/v1/process/mine`, `/api/v1/process/traces`
5. `/api/v1/root-cause/run`, `/api/v1/root-cause/evidence`, `/api/v1/root-cause/assist/setup`, `/api/v1/root-cause/assist/interpret`
6. `/api/v1/ai/ontology/question`, `/api/v1/ai/process/interpret`, `/api/v1/ai/root-cause/setup`, `/api/v1/ai/root-cause/interpret`, `/api/v1/ai/guided-investigation`

## Route Strategy

| Legacy route | Current route target | Plan |
|---|---|---|
| `/` | `/` | Upgrade home to richer mission-control index using current module cards + health |
| `/ontology/[tab]` | `/ontology` | Implement tabbed read-only explorer under `/ontology`; deep-link via query params |
| `/inspector` | `/process` | Fold object/process inspector UX into process module as secondary panes |
| `/inspector/analytics` | `/process` | Merge mining analytics controls into process module |
| `/assistant` | `/insights` and module side panels | Make guided investigation the primary assistant surface with module-local AI shortcuts |
| `/changes` | none | Keep out-of-scope for backend parity in this track |
| `/object-store` | `/ingestion` | Implement a history-backed Object Explorer workflow under ingestion UX (no legacy backend parity) |

## Execution Phases

## Phase A: Replatform Foundation

**Goal:** establish shell, tokens, primitives, and adapter boundaries before feature migration.

Deliverables:

1. New application shell in `seer-ui/src/app/layout.tsx` inspired by `seer-ui-old` sidebar ergonomics.
2. Consolidated design tokens and typography in `seer-ui/src/app/globals.css` with accessibility guardrails.
3. Shared module chrome and navigation metadata in `seer-ui/src/components`.
4. New `seer-ui/src/lib/adapters/` boundary for transforming backend DTOs to UI view models.
5. Lint/build green after shell replacement.

Exit criteria:

1. All existing routes render in the new shell without runtime errors.
2. Mobile and desktop breakpoints verified on key routes.
3. No API contract changes required.

## Phase B: Ontology Experience v2 (Read-Only)

**Goal:** deliver old-style graph-first ontology exploration while preserving read-only constraints.

Deliverables:

1. Rich tabbed ontology explorer (overview, objects, actions, events, triggers) in `seer-ui/src/components`.
2. Query-param deep links for selected concept and tab.
3. Copilot conversation UX upgraded with mission-control quality interaction patterns.
4. Read-only enforcement in UI controls and backend contract usage.
5. Optional backend extension: add a read-only ontology graph endpoint if existing concept/detail endpoints are insufficient for graph rendering.
6. Explicitly exclude ontology editor artifacts from migration (editor tabs, create/edit dialogs, mutation actions).

Exit criteria:

1. No ontology mutation UI actions exist.
2. Ontology views operate on canonical `/api/v1/ontology/*` endpoints or a new read-only endpoint approved by architecture docs.
3. Copilot workflows still use `/api/v1/ai/ontology/question`.

## Phase C: Process Explorer Experience v2

**Goal:** bring inspector-level process analysis experience into `/process`.

Deliverables:

1. Enhanced run control panel with richer filtering and trace workflow.
2. Graph + drill-down + statistics layout aligned to old inspector ergonomics.
3. AI interpretation panel integrated without breaking run-state semantics.
4. Adapter mapping from `/api/v1/process/mine` and `/api/v1/process/traces` to richer UI models.
5. Coordinate with ingestion module object exploration workflow to keep investigation handoffs seamless.

Exit criteria:

1. Existing process endpoints unchanged.
2. Deterministic drill-down behavior maintained.
3. Performance acceptable on representative fixture sizes.

## Phase D: Root-Cause and Guided Investigation Experience v2

**Goal:** lift RCA and guided flow UX to old mission-control quality with current evidence/caveat policies.

Deliverables:

1. RCA configuration and results layout upgrade in `/root-cause`.
2. Evidence drill-down and comparison interactions improved.
3. Guided investigation page upgraded with better orchestration visibility and actionability.
4. Shared AI response rendering reused consistently.
5. Guided investigation remains the primary cross-module AI-first workflow entrypoint.

Exit criteria:

1. All RCA actions remain backed by canonical root-cause and AI contracts.
2. Evidence and caveat rendering remains policy-compliant.
3. Existing run-state pattern (`queued`, `running`, `completed`, `error`) remains consistent.

## Phase E: Assistant Pattern Consolidation

**Goal:** port the strongest assistant interaction concepts without reintroducing deprecated contracts.

Deliverables:

1. Conversation thread ergonomics and persistence patterns adapted from `seer-ui-old` where contract-compatible.
2. Safe-mode/redaction behavior integrated with current AI response envelopes.
3. Module-context AI shortcuts added from ontology/process/root-cause to guided investigation.

Exit criteria:

1. No dependency on legacy `/assistant/generate`.
2. Redaction and persistence behavior documented and tested.

## Phase F: Hardening, Rollout, and Cleanup

**Goal:** make the replatform production-ready and retire duplicated legacy code paths.

Deliverables:

1. Test expansion across adapter logic, module rendering, and key UI flows.
2. Optional screenshot baselines for top routes.
3. Rollout checklist including rollback strategy.
4. Post-launch bug triage template and SLO-style UI quality metrics.
5. Follow-up debt items recorded in `docs/exec-plans/tech-debt-tracker.md`.

Exit criteria:

1. `seer-ui` lint/build pass.
2. Backend test suite remains green.
3. No P0/P1 UI regressions open at release cut.

## Phase G: Ingestion Object Explorer Experience v2

**Goal:** provide object exploration workflows without legacy object-store backend dependencies.

Deliverables:

1. Add Object Explorer surface under `/ingestion` that supports object history exploration.
2. Implement object-centric timeline and relation exploration using existing history contracts:
   - `GET /api/v1/history/objects/timeline`
   - `GET /api/v1/history/relations`
   - `GET /api/v1/history/events` (for supporting event details where needed)
3. Add adapter mappings from history DTOs to object explorer view models.
4. Provide deep links from `/insights`, `/process`, and `/root-cause` evidence panels to Object Explorer context.

Exit criteria:

1. No new legacy object-store backend endpoints are required.
2. Object exploration remains performant on representative history windows.
3. Investigation workflow handoff from AI/process/RCA to object exploration is smooth.

## Workstream Breakdown

Workstream UX-1: Shell and design system migration.

Workstream UX-2: Adapter and contract mapping layer.

Workstream UX-3: Ontology explorer replatform.

Workstream UX-4: Process + RCA + guided flow replatform.

Workstream UX-5: Assistant pattern integration and hardening.

Workstream UX-6: Ingestion object explorer replatform on history contracts.

Each workstream has an owner and can run in parallel only when dependencies are satisfied.

## Dependency Order

1. Phase A must complete before B/C/D/E begin.
2. Phase B can run in parallel with C after shared adapter boundaries are established.
3. Phase D depends on reusable AI rendering and run-state primitives from A.
4. Phase E depends on D to avoid duplicate AI interaction architecture.
5. Phase G depends on A and shared adapter boundaries from B/C.
6. Phase F depends on all prior phases.

## Acceptance Criteria

1. UX parity target achieved for high-priority interactions (navigation, ontology exploration, process/RCA analysis, guided AI flow).
2. All migrated flows operate on canonical backend contracts, with explicit approval for any new read-only backend endpoints.
3. Ontology remains strictly read-only in UI and behavior.
4. No regression on MVP-critical paths:
   - ontology exploration + copilot,
   - process run + drill-down + AI interpretation,
   - RCA run + evidence + AI assists,
   - guided investigation flow,
   - ingestion object exploration over history store.
5. Accessibility baseline:
   - keyboard navigation for major controls,
   - visible focus states,
   - sufficient contrast on core views.
6. Performance baseline:
   - no severe interaction jank on representative datasets,
   - route hydration and major panel renders tracked via explicit metrics.

## Verification Plan

1. `cd seer-ui && npm run lint`
2. `cd seer-ui && npm run build`
3. `cd seer-backend && uv run pytest -q`
4. UI integration tests for module flows (tooling to be selected in implementation kickoff).
5. Manual smoke checklist across `/`, `/ontology`, `/process`, `/root-cause`, `/insights`, `/ingestion`.

## Deliverables by Repository Area

1. `seer-ui/src/app/*` route and layout updates.
2. `seer-ui/src/components/*` module and shared component replatform.
3. `seer-ui/src/lib/*` adapter and API integration updates.
4. `seer-backend/src/seer_backend/api/*` only if required for additive read-only contract support.
5. `docs/product-specs/*` updates for any changed interaction behavior.
6. `docs/design-docs/*` updates for major UX architecture decisions.

## Risks and Mitigations

1. Risk: accidental reintroduction of ontology editing workflows from legacy components.  
   Mitigation: explicit "read-only gate" in each phase review; reject create/edit controls during code review.
2. Risk: over-porting legacy code creates excessive maintenance burden.  
   Mitigation: port patterns/components selectively; do not copy legacy API clients directly.
3. Risk: contract drift between frontend expectations and backend payloads.  
   Mitigation: adapter layer + contract tests per endpoint family.
4. Risk: timeline slip due to broad UI ambition.  
   Mitigation: lock prioritized parity scope first; keep `/changes` backend parity out-of-scope and implement object exploration only on existing history APIs.
5. Risk: visual redesign regresses accessibility.  
   Mitigation: include explicit accessibility checks in acceptance and CI linting.
6. Risk: object explorer built on current history APIs may not match all legacy affordances initially.  
   Mitigation: prioritize investigation-critical interactions first, then iterate advanced affordances.

## Out-of-Scope Items (Explicit)

1. Any Change Intelligence feature port in this track (UI and backend parity), including `/changes` route migration.
2. Any ontology editing/authoring feature port from `seer-ui-old`, including create/edit/delete/publish flows.
3. Legacy Object Store backend parity (`/objects/*`) in this track.
4. Any backend endpoint expansion unrelated to read-only ontology or history-backed object exploration.

Out-of-scope items should only be revisited via a new scoped plan and product approval.

## Resolved Decisions (2026-02-22)

1. Ontology graph handling will follow old UI-style bounded exploration patterns; we do not assume full-graph fit/render in one view.
2. Object Explorer workflow is in-scope and will be implemented under `/ingestion` using existing history store contracts.
3. Guided investigation is the primary AI-first workflow surface, with module-local shortcuts feeding into it.
4. Theming and theme-toggle support from old UI are in-scope.
5. Change Intelligence and ontology editing capabilities are explicitly excluded from this migration.

## Progress Tracking

- [x] Phase A complete
- [x] Phase B complete
- [x] Phase C complete
- [x] Phase D complete
- [x] Phase E complete
- [x] Phase G complete
- [x] Phase F complete

Current execution state:

- `completed`: Phases A, B, C, D, E, G, and F completed sequentially on 2026-02-22

## Phase F Completion Notes (2026-02-22)

Delivered assets:

1. Verification harness and hardening tests in `seer-ui/tests/`:
   - adapters: ontology/process/root-cause guided transformation coverage,
   - flows: guided shortcut/handoff integrity,
   - rendering: run-state and AI safe-mode rendering guardrails.
2. Rollout checklist and rollback/triage/SLO expectations in:
   - `docs/product-specs/ui-experience-replatform-phase-f-hardening-rollout.md`
3. Harness design rationale and maintenance guidance in:
   - `docs/design-docs/ui-experience-replatform-phase-f-verification-harness.md`
4. Index updates:
   - `docs/product-specs/index.md`
   - `docs/design-docs/index.md`

Validation evidence:

1. `cd seer-ui && npm run test` passed (5 tests, 0 failures).
2. `cd seer-ui && npm run lint` passed.
3. `cd seer-ui && npm run build` passed (Next.js production build completed).

Phase F boundary confirmations:

1. No Change Intelligence scope introduced.
2. No ontology editing scope introduced.

## Initial Decision Log

1. Canonical frontend remains `seer-ui`; `seer-ui-old` is a donor reference, not a deployment target.
2. Backend contract compatibility takes priority over visual parity.
3. Legacy backend parity for Change Intelligence and Object Store remains out-of-scope in this track; object exploration is delivered via existing history contracts.
4. Ontology migration scope is strictly read-only exploration and AI context; no editing flows are permitted.

## Plan Maintenance Rules

1. Update this file at each phase boundary with completion notes and evidence.
2. Record any scope deferrals in `docs/exec-plans/tech-debt-tracker.md`.
3. Move this plan to `docs/exec-plans/completed/` only after all acceptance criteria pass and evidence is captured.
