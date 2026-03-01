# Post-MVP Exec Plan: OC-DFG UI Layout Engine Upgrade

**Status:** completed  
**Track:** post-MVP analytics UX refinement  
**Last updated:** 2026-03-01

---

## Objective

Adapt the OC-DFG primary UI rendering to use a dedicated object-centric layout engine aligned to the target algorithm:

1. object-type track ordering optimized by exact interaction maximization,
2. track-aware node vertical placement,
3. cycle handling + layered left-to-right flow,
4. weighted crossing minimization,
5. overlap-safe coordinate assignment and orthogonal edge routing.

## Delivery Stance

1. Forward-only implementation: replace legacy OC-DFG-through-OCPN layout adaptation where it conflicts with target behavior.
2. Keep OCPN/BPMN secondary flows intact unless explicitly required for OC-DFG delivery.
3. Document any intentionally removed legacy behavior in this plan and related product spec updates.
4. Reuse existing layout-engine capabilities already in the stack where they satisfy algorithm requirements (especially network simplex layering and coordinate refinement), instead of re-implementing heavy internals.
5. Treat runtime performance as a first-class constraint for interactive UI rendering.

## Locked Algorithm Specification (Implementation Contract)

This plan must implement the OC-DFG layout algorithm below at the same fidelity as the design input.

### 1) Data Ingestion and Graph Modeling

Objective: parse OC-DFG response JSON into sets and mappings used by layout stages.

1. Initialize object types set `OT` from `graph.objectTypes`, augmented by any `edge.objectType` not listed.
2. Initialize node set `V` from `graph.nodes`.
3. Build mapping `M_N(v)` for each node `v`, where:
   - `M_N(v)` is the set of object types incident to `v`.
   - for each edge `e=(u,v,ot)` add `ot` to `M_N(u)` and `M_N(v)`.
4. Initialize directed edge set `E` from `graph.edges`.
   - each edge stores `source`, `target`, `objectType`, and `weight=count`.

### 2) Track Ordering (Y-Axis Topology)

Objective: assign one horizontal track per object type and order tracks to maximize adjacent interactions.

1. Build interaction matrix `I` of size `|OT| x |OT|`, initialized to `0`.
2. For every node `v`:
   - if `|M_N(v)| > 1`, for every unordered pair `(ot_i, ot_j)` in `M_N(v)`:
     - increment `I(i,j)` and `I(j,i)` by `1`.
3. Solve exact maximum-weight Hamiltonian path over object types with Held-Karp dynamic programming:
   - maximize `sum_{k=1..n-1} I(t_k, t_{k+1})`,
   - return ordered tracks `T=[t_1,...,t_n]`,
   - use deterministic tie-breaking for equal scores.

### 3) Node Y-Coordinate Assignment

Objective: compute base vertical placement from object-type tracks.

1. Define `TRACK_SPACING`.
2. Assign per-track base coordinate:
   - `Y_base(t_k) = k * TRACK_SPACING` for each `t_k in T`.
3. For each node `v`:
   - single-type node: `Y(v)=Y_base(ot)`.
   - multi-type node: centroid
     - `Y(v)= (1/|M_N(v)|) * sum_{ot in M_N(v)} Y_base(ot)`.
   - no-type fallback: deterministic global centroid of available track bases.

### 4) Layering (X-Axis Topological Sorting)

Objective: assign each node to discrete left-to-right layers while minimizing total edge length.

1. Cycle removal:
   - run DFS over directed edges,
   - identify back-edges and temporarily reverse them,
   - keep reversal metadata for restoration.
2. Network simplex layering:
   - run network simplex rank assignment on the DAG (not longest-path heuristic),
   - optimize `sum_{(u,v) in E} (L(v)-L(u))` with minimum edge span constraints.
3. Dummy node insertion:
   - for any edge with `L(v)-L(u) > 1`, insert dummy nodes in intermediate layers,
   - replace each long edge with adjacent-layer edge chain for crossing minimization and routing.

### 5) Edge Cross-Minimization

Objective: reduce crossings by reordering nodes within each layer.

1. Forward sweep (left to right):
   - for each layer `L_i`, compute weighted barycenter for each node from predecessors in `L_{i-1}`:
     - `B(v)= (sum w(u,v)*Y(u)) / (sum w(u,v))`.
   - sort layer nodes by `B(v)`.
2. Backward sweep (right to left):
   - recompute barycenters from successors in `L_{i+1}` with same weighting.
   - sort by barycenter.
3. Iterate forward/backward sweeps until:
   - crossing count stops improving, or
   - strict iteration cap is reached (24 iterations).

### 6) Spatial Optimization and Coordinate Assignment

Objective: convert logical layering/order into renderable pixel coordinates and orthogonal edge geometry.

1. Base X by layer:
   - `X(L_i)=i * LAYER_SPACING`.
2. Horizontal/coordinate refinement:
   - apply Brandes-Kopf style coordinate refinement (four directional biases + balanced merge) where feasible in implementation constraints,
   - preserve long straight segments and compact width.
3. Overlap resolution:
   - within each layer, enforce node separation >= `NODE_HEIGHT`,
   - apply proportional vertical shifts while preserving sorted order.
4. Edge routing and restoration:
   - route edges as orthogonal polylines through dummy-node chain coordinates,
   - restore original edge directions for any cycle-break reversals.

## Notes On Scope Fidelity

1. Held-Karp track ordering is mandatory and exact.
2. Layering must use network simplex rank assignment.
3. Crossing minimization must be weighted barycenter with bidirectional sweeps and convergence cap.
4. The OC-DFG primary view must consume this dedicated layout path (no OCPN-layout adaptation fallback).
5. Existing layout engines/libraries should be used for subproblems where they are already correct and performant for the target algorithm stage.

## Engine Mapping (Locked)

The implementation splits responsibilities as follows:

1. Must be custom OCPM logic in Seer UI:
   - Phase 1 data ingestion/modeling (`OT`, `V`, `E`, `M_N(v)`),
   - Phase 2 interaction matrix + exact Held-Karp track ordering,
   - Phase 3 track-based node membership/centroid assignment.
2. Must be delegated to ELK layered engine (not custom re-implementation):
   - Phase 4 layering with network simplex behavior,
   - Phase 5 crossing minimization (weighted barycenter),
   - Phase 6 coordinate assignment/refinement (Brandes-Kopf family) + orthogonal routing.
3. OC-DFG layout path should use ELK partitioning/swimlane constraints to enforce object-type track ordering.
4. Required ELK properties for the OC-DFG dedicated layout path:
   - `elk.algorithm = layered`
   - `elk.direction = RIGHT`
   - `elk.edgeRouting = ORTHOGONAL`
   - `elk.layered.partitioning.activation = TRUE`

## Performance Constraints

1. Keep algorithmic complexity bounded for expected OC-DFG sizes:
   - Held-Karp runs only on object types (`|OT|`), not activity nodes.
   - crossing-sweep iterations are capped at 24.
2. Avoid unnecessary layout recomputation:
   - recompute only when OC-DFG data or display-critical props change.
3. Reuse in-memory indices/maps across layout stages inside a single layout pass.
4. Preserve deterministic ordering/tie-breaking to avoid jitter across renders.
5. Validate that primary OC-DFG rendering remains responsive for typical datasets used in Inspector Insights.

## Baseline Failure Ledger (Before Phase Work)

Validated on 2026-03-01:

1. UI lint: `cd seer-ui && npm run lint`
2. UI contract tests: `cd seer-ui && npm run test:contracts`
3. UI build: `cd seer-ui && npm run build`

Known unrelated failures at kickoff: none.

## Phases

### Phase 1 - Baseline Validation Ledger

Scope:

1. Run frontend lint, contract tests, and build before implementation.
2. Record pass/fail baseline and known unrelated failures (if any).

Exit criteria:

1. Baseline state is recorded in this plan.
2. Any pre-existing failures are explicitly logged.

Validation:

1. `cd seer-ui && npm run lint`
2. `cd seer-ui && npm run test:contracts`
3. `cd seer-ui && npm run build`

### Phase 2 - OC-DFG Layout Engine Implementation

Scope:

1. Add a dedicated OC-DFG graph rendering path in `seer-ui`.
2. Implement algorithmic layout stages:
   - graph ingestion + node-object-type association from OC-DFG edges,
   - interaction-matrix track ordering via Held-Karp maximum-weight Hamiltonian path,
   - track-based base Y assignment for single-type and multi-type nodes,
   - ELK layered + partitioning configuration for layering/crossing/coordinate assignment and orthogonal routing,
   - explicit lane/partition constraints so object-type track ordering is preserved.
3. Keep deterministic tie-breaking/order behavior.
4. Optimize for UI responsiveness and avoid layout jitter/redundant reruns.

Exit criteria:

1. OC-DFG primary card no longer depends on OCPN conversion for layout.
2. Layout uses dedicated object-type tracks and layered orthogonal routing.
3. OCPN secondary and BPMN tertiary cards remain functional.

Validation:

1. `cd seer-ui && npm run lint -- app/components/inspector/process-mining-panel.tsx app/components/inspector/ocdfg-graph.tsx app/lib/process-mining/ocdfg-layout.ts app/lib/api/process-mining.ts`
2. `cd seer-ui && npm run test:contracts`

### Phase 3 - Final Validation + Docs + Archive

Scope:

1. Run full frontend validation gates.
2. Update process explorer product spec for OC-DFG layout behavior.
3. Mark plan complete and archive to `docs/exec-plans/completed/`.
4. Update active/completed indexes.

Exit criteria:

1. Full UI validation gates pass.
2. Docs reflect delivered OC-DFG layout behavior.
3. Plan archived with completion log and decision updates.

Validation:

1. `cd seer-ui && npm run lint`
2. `cd seer-ui && npm run test:contracts`
3. `cd seer-ui && npm run build`

## Progress Log

### 2026-03-01 - Plan Created

1. Initialized phased plan for OC-DFG UI layout algorithm adaptation.
2. Defined baseline validation ledger and delivery gates.

### 2026-03-01 - Phase 1 Completed (Baseline Validation Ledger)

1. Ran `cd seer-ui && npm run lint` (pass, no reported issues).
2. Ran `cd seer-ui && npm run test:contracts` (pass, `6 passed`, `0 failed`).
3. Ran `cd seer-ui && npm run build` (pass, production build completed successfully).
4. Recorded no known unrelated baseline failures.

### 2026-03-01 - Implementation Strategy Update

1. Locked hybrid engine strategy per user direction:
   - custom OCPM brain for phases 1-3,
   - ELK layered engine for phases 4-6.
2. Added required ELK settings and partitioning requirement to preserve ordered object-type lanes.
3. Prioritized layout-engine reuse and performance over full custom reimplementation of network-simplex/crossing/coordinate internals.

### 2026-03-01 - Phase 2 Completed (OC-DFG Layout Engine + UI Integration)

1. Replaced OC-DFG primary rendering path with dedicated OC-DFG component/layout engine (removed OCPN-layout adaptation for primary OC-DFG).
2. Implemented exact Held-Karp track ordering + deterministic tie-breaking for object-type lane ordering.
3. Delegated layered/crossing/coordinate/routing stages to ELK layered engine with required partitioning constraints:
   - `elk.algorithm=layered`
   - `elk.direction=RIGHT`
   - `elk.edgeRouting=ORTHOGONAL`
   - `elk.layered.partitioning.activation=TRUE`
4. Added shared graph node card component based on ontology explorer node styling and reused it across ontology + OC-DFG nodes.
5. Materialized object nodes and object->start-activity edges directly in OC-DFG UI data model (`nodes[]`/`edges[]`) instead of generating synthetic edges inside layout.
6. Enforced ontology-display-driven naming for OC-DFG visible node labels.
7. Added deterministic color semantics:
   - object nodes use per-object-type palette,
   - single-object event nodes use lighter variant of the same object-type palette.
8. Kept secondary OCPN/BPMN flows intact.
9. Phase 2 validation:
   - targeted lint passes on touched OC-DFG/ontology/shared-node files,
   - contract tests pass (`6/6`).

### 2026-03-01 - Phase 3 Completed (Final Validation + Docs + Archive)

1. Final UI validation gates passed:
   - `cd seer-ui && npm run lint`
   - `cd seer-ui && npm run test:contracts`
   - `cd seer-ui && npm run build`
2. Updated `docs/product-specs/process-explorer-phase-3.md` to reflect:
   - object nodes + object-to-start-activity edges in OC-DFG UI,
   - ontology-display-driven labeling behavior,
   - node color semantics for object/single-object-event mapping.
3. Updated execution-plan indexes and archived this plan to `docs/exec-plans/completed/`.

## Decision Log

### 2026-03-01

1. OC-DFG primary visualization should use its own layout engine instead of adapting through OCPN layout conversion.
2. Layout optimization should prioritize deterministic, topology-preserving readability over preserving legacy OC-DFG node placement patterns.
3. OC-DFG object nodes and start edges should be represented in the UI OC-DFG data model rather than synthesized during layout.
4. Shared graph node card styling should be reused across ontology explorer and OC-DFG nodes for visual consistency and maintainability.

## Required Docs Updates In This Plan

1. `docs/product-specs/process-explorer-phase-3.md`
2. `docs/exec-plans/active/index.md`
3. `docs/exec-plans/completed/README.md` (upon archive)
4. `docs/exec-plans/completed/ocdfg-ui-layout-engine-upgrade.md` (archived plan)
