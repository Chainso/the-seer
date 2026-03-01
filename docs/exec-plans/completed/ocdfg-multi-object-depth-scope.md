# Post-MVP Exec Plan: OC-DFG Multi-Object Depth Scope

**Status:** completed  
**Track:** post-MVP analytics UX + backend contract extension  
**Last updated:** 2026-03-01

---

## Objective

Deliver depth-based multi-object process scope where:

1. Frontend resolves depth-expanded object-model scope.
2. Backend accepts explicit multi-object type inputs and mines against expanded event scope.
3. UI shows users which object models are included for the selected depth.
4. OC-DFG (primary) and OCPN (secondary) both use the same resolved multi-object scope.

## Delivery Stance

1. Forward-only implementation: do not preserve legacy behavior by default.
2. Break legacy single-object assumptions where needed to match the target model.
3. If contracts/behavior change, update docs in the same delivery.

## Baseline Failure Ledger (Before Phase Work)

Validated on 2026-03-01 after commit `e81cfc7`:

1. Backend lint: pass (`seer-backend/.venv/bin/ruff check src tests`)
2. Backend tests: pass (`seer-backend/.venv/bin/pytest`)
3. Backend build: pass (`cd seer-backend && uv build`)
4. UI lint: pass (`cd seer-ui && npm run lint`)
5. UI contract tests: pass (`cd seer-ui && npm run test:contracts`)
6. UI build: pass (`cd seer-ui && npm run build`)

Known unrelated failures at kickoff: none.

## Locked Semantics

### Frontend Depth Resolution

Given anchor object model `A` and depth `D`:

1. `D=1`: include only `A`.
2. `D=2`: include object models that share an ontology event reference with `A`.
3. `D=3+`: recursively include object models that share ontology event references with depth `D-1` models.
4. Scope resolution is frontend-owned and deterministic.

### Backend Multi-Object Mining

1. Backend consumes explicit `include_object_types[]` from client.
2. Mining event scope is all events in the selected window that involve at least one included object type.
3. Relation/object extraction is filtered to included object types.
4. If `include_object_types` is omitted, backend falls back to anchor-only behavior (`anchor_object_type`).

## Phases

### Phase 1 - Backend Multi-Object Scope Execution

Scope:

1. Rework process-mining extraction scope so `include_object_types[]` drives event selection (not only relation filtering).
2. Apply this to both:
   - `POST /api/v1/process/mine`
   - `POST /api/v1/process/ocdfg/mine`
3. Keep Arrow-backed dataframe path intact for OC-DFG.
4. Add backend tests proving multi-object inclusion behavior for both endpoints.

Exit criteria:

1. Backend mines events across all included object types (within window).
2. OC-DFG and OCPN endpoints both honor multi-object scope.
3. Targeted backend tests pass.

Validation:

1. `cd seer-backend && .venv/bin/ruff check src/seer_backend/analytics src/seer_backend/api tests/test_process_phase3.py`
2. `cd seer-backend && .venv/bin/pytest -q tests/test_process_phase3.py`

### Phase 2 - Frontend Depth Resolver + Included Objects Display

Scope:

1. Add depth dropdown to Process Mining filters (`depth=1` default).
2. Implement frontend depth resolver from ontology graph relationships.
3. Build resolved `modelUris[]` scope from depth and pass to mining calls.
4. Add a clear included-object scope display in UI.
5. Keep OC-DFG first; OCPN/BPMN secondary.

Exit criteria:

1. User can change depth and immediately see included object models.
2. Mining requests pass explicit multi-object model scope.
3. UI contract tests and build pass.

Validation:

1. `cd seer-ui && npm run lint -- app/components/inspector/process-mining-panel.tsx app/lib/api/process-mining.ts app/types/process-mining.ts tests/insights.contract.test.mjs`
2. `cd seer-ui && node --test tests/insights.contract.test.mjs tests/history.contract.test.mjs`
3. `cd seer-ui && npm run build`

### Phase 3 - Ratification, Docs, Plan Archive

Scope:

1. Run full backend + UI validation gates.
2. Update product/architecture docs for frontend-owned depth resolution + backend multi-object execution semantics.
3. Move this plan from `active/` to `completed/` and update indexes.

Exit criteria:

1. Full validation passes.
2. Documentation is consistent with delivered behavior.
3. Plan is archived to completed.

Validation:

1. `cd seer-backend && .venv/bin/ruff check src tests`
2. `cd seer-backend && .venv/bin/pytest`
3. `cd seer-backend && uv build`
4. `cd seer-ui && npm run lint`
5. `cd seer-ui && npm run test:contracts`
6. `cd seer-ui && npm run build`

## Progress Log

### 2026-03-01 - Plan Created

1. Added initial phased execution map for depth-based multi-object process scope.
2. Set baseline failure ledger and no-legacy delivery stance.

### 2026-03-01 - Plan Rebased After User Direction Update

1. Removed backend scope-resolution endpoint phase.
2. Locked frontend-owned depth resolution model.
3. Refocused backend phase to explicit multi-object mining execution only.
4. Restarted phase sequencing from fresh after interrupted worker.

### 2026-03-01 - Phase 1 Completed (Backend Multi-Object Scope Execution)

1. Reworked backend extraction scope so event selection is window-bounded and driven by effective included object types (`include_object_types[]` or fallback anchor object type).
2. Applied the same scope model to both OCPN (`/api/v1/process/mine`) and OC-DFG (`/api/v1/process/ocdfg/mine`) extraction paths.
3. Preserved Arrow-backed OC-DFG dataframe flow while changing only scope selection/filtering semantics.
4. Added phase tests proving multi-object inclusion changes mined output for both endpoints.
5. Ran Phase 1 validation gates for targeted lint and tests; both passed.

### 2026-03-01 - Phase 2 Completed (Frontend Depth Resolver + Included Objects Display)

1. Added a Process Mining depth dropdown (`depth=1` default) and wired it into the shared scope filters surface.
2. Implemented frontend-owned depth scope resolution from ontology relationships using event-sharing semantics derived from ontology graph edges.
3. Changed Process Mining requests to always pass explicit resolved `modelUris[]` scope for both OC-DFG and OCPN calls.
4. Added a visible included-object-models scope panel that updates immediately when anchor model or depth changes.
5. Kept OC-DFG first and OCPN/BPMN as secondary panels; no regressions in primary/secondary panel ordering or labels.
6. Ran Phase 2 validation gates (`lint`, contract tests, build); all passed.

### 2026-03-01 - Phase 3 Completed (Ratification, Docs, Plan Archive)

1. Ran full backend validation gates:
   - `cd seer-backend && .venv/bin/ruff check src tests` (pass)
   - `cd seer-backend && .venv/bin/pytest` (pass)
   - `cd seer-backend && uv build` (pass)
2. Ran full UI validation gates:
   - `cd seer-ui && npm run lint` (pass)
   - `cd seer-ui && npm run test:contracts` (pass)
   - `cd seer-ui && npm run build` (pass)
3. Updated `docs/product-specs/process-explorer-phase-3.md` with frontend-owned depth resolution semantics, explicit included-object scope behavior, and acceptance expectations for multi-object scope parity across OC-DFG/OCPN.
4. Updated `ARCHITECTURE.md` to codify frontend depth-scope ownership and backend explicit `include_object_types[]` execution semantics as architecture-level contracts/invariants.
5. Archived plan to `docs/exec-plans/completed/ocdfg-multi-object-depth-scope.md` and updated active/completed indexes to reflect closed status.

## Decision Log

### 2026-03-01

1. Depth scope resolution belongs in frontend, derived from ontology graph relationships.
2. Backend responsibility is efficient and correct execution of client-provided multi-object scope.
3. Legacy single-object assumptions can be removed when they conflict with this model.
4. Effective backend mining scope is now computed as:
   - `include_object_types[]` when provided (with anchor normalization by request model), else
   - `[anchor_object_type]` fallback for anchor-only behavior.
5. Event selection and relation/object extraction must use the same effective object-type scope in both OCPN and OC-DFG paths.
6. Frontend depth traversal is a bounded breadth-first expansion over object models, where model adjacency is defined by shared event references in ontology relationships.
7. Event-sharing scope resolution includes direct event-to-model links and action-produced-event propagation so derived references stay aligned with ontology semantics.
8. Process Mining UI now treats explicit multi-object scope as the default request shape, replacing anchor-only frontend request behavior.
9. Final ratification requires no additional feature work; only validation, documentation alignment, and archival/index consistency updates are permitted in Phase 3.

## Required Docs Updates In This Plan

1. `docs/product-specs/process-explorer-phase-3.md`
2. `ARCHITECTURE.md` (frontend-owned depth resolution + backend multi-object execution semantics)
3. `docs/exec-plans/active/index.md`
4. `docs/exec-plans/completed/README.md`
