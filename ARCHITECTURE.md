# ARCHITECTURE

This document is the high-level architecture map for Seer.

It is intentionally stable and coarse-grained. It answers:
- where major responsibilities live,
- where system boundaries are,
- and which architectural invariants must remain true.

For product direction, see `VISION.md`.  
For delivery phases and acceptance gates, see `docs/exec-plans/active/mvp-roadmap-2026.md`.

## Bird's-Eye View

Seer ingests:
1. ontology definitions from Prophet local Turtle output, and
2. operational events with object snapshots.

Seer stores:
1. ontology state in Fuseki named graphs, and
2. immutable event/object/link histories in ClickHouse.

Seer computes:
1. object-centric process mining outputs, and
2. ranked root-cause insight hypotheses.

Seer presents:
1. read-only ontology exploration,
2. process exploration,
3. root-cause analysis workflows,
4. AI-assisted investigation experiences.

## Top-Level System Map

1. `seer-ui/`: React + Next.js application (initialized with `create-next-app`) for exploration and AI workflows.
2. `seer-backend/`: Python API and orchestration for ontology ingestion, history ingestion, analytics, and AI tools.
3. `docker/`: local composition for backend, UI, Fuseki, ClickHouse, and supporting runtime dependencies.
4. `prophet/`: upstream Prophet assets used as ontology authoring source and metamodel context.
5. `docs/`: system-of-record documentation, design records, and execution plans.

## Code Map

This codemap describes where responsibilities belong. Names are architectural targets and can be located with symbol search.

### `seer-ui/` (Experience Layer)

Primary responsibilities:
1. module-level user experiences: ontology explorer, ingestion monitor, process explorer, root-cause lab, insights dashboard.
2. AI interaction surfaces (chat and guided analysis flows).
3. visualization and drill-down over backend-provided results.
4. unified assistant experience across global slide-over panel and dedicated `/assistant` page, backed by one shared frontend runtime/state model.

Expected internal areas:
1. route/application structure (`app` with Next.js App Router).
2. reusable UI components (`components`).
3. backend and AI client adapters (`lib` / service adapters).
4. visualization modules (process map, ontology graph, RCA result views).

Architectural boundary:
- UI is read-only for ontology definitions (no ontology editing/publishing surface).

### `seer-backend/` (System Core)

Primary responsibilities:
1. HTTP API boundary for UI and ingestion clients.
2. ontology ingestion/validation/upsert flow.
3. event ingestion and history persistence.
4. process mining and root-cause analysis execution.
5. AI tool orchestration over ontology and analytics services.

Expected internal service areas:
1. `ontology` domain:
   - Turtle ingestion
   - SHACL validation against Prophet base metamodel
   - Fuseki named-graph upsert
   - read-only SPARQL query service
   - concept index/list APIs filtered to user graph concepts used by ontology exploration
2. `history` domain:
   - event parsing and validation
   - writes to `event_history`, `object_history`, `event_object_links`
   - object reference normalization utilities
3. `analytics` domain:
   - ClickHouse extraction (Arrow-backed dataframe path)
   - object-centric Petri net execution via `pm4py`
   - root-cause pipeline (neighborhood extraction + ranking)
4. `ai` domain:
   - unified AI gateway routing by module (`ontology`, `process`, `root_cause`)
   - module-scoped tool permission policy
   - response-policy enforcement (`informational` vs `analytical`)
   - evidence/caveat packaging for analytical outputs
5. `api` / `transport` domain:
   - request/response contracts
   - endpoint composition

Architecture boundary:
- backend owns all state mutation; UI consumes backend contracts.

### `docker/` (Runtime Composition)

Primary responsibilities:
1. deterministic local environment startup.
2. service wiring, network configuration, and local environment defaults.
3. reproducible developer runtime for MVP.

### `prophet/` (Authoring Source Boundary)

Primary responsibilities relative to Seer:
1. provide ontology authoring and base metamodel context.
2. provide local ontology output consumed by Seer.

Architecture boundary:
- Seer consumes Prophet outputs; Seer does not become an ontology authoring platform.

### `docs/` (Repository Knowledge System)

Primary responsibilities:
1. encode architecture, design, and product decisions in-repo.
2. maintain active/completed execution plans and technical debt tracking.
3. provide agent- and human-legible system context.

## Data Plane Map

### Ontology Plane

Stack: RDFLib + SPARQL over Fuseki.

Flow:
1. ingest local ontology Turtle,
2. validate with SHACL against Prophet metamodel,
3. upsert into named graphs,
4. expose read/query interfaces.

### History Plane

Stack: ClickHouse core immutable history tables.

Core tables:
1. `event_history`
2. `object_history`
3. `event_object_links`

Design intent:
- keep full histories; do not collapse to only latest object state.

### Analytics Plane

Stack: Python analytics services + `pm4py`.

Flow:
1. query ClickHouse programmatically,
2. load Arrow-backed dataframes,
3. run object-centric mining and RCA methods,
4. return structured insight contracts.

## Core Contracts

1. Ontology ingest contract:
   - input: Prophet local Turtle files
   - validation: SHACL against Prophet base metamodel
   - storage: URI-identity-driven upsert into Fuseki named graphs
   - explorer query contract: concept lists exclude Prophet base concepts and non-graph categories
2. Event history contract:
   - table: `event_history`
   - identity: UUID `event_id`
   - timeline: `occurred_at` as user-facing event time
3. Object history contract:
   - table: `object_history`
   - identity: UUID `object_history_id`
   - includes `object_type`, raw object reference, canonical object reference, and hash
4. Event-object link contract:
   - table: `event_object_links`
   - ties `event_id` to specific `object_history_id`
   - includes `object_type` and normalized object reference fields
5. Insight result contract:
   - analytics output shape for UI and AI rendering
   - includes hypothesis, scoring metrics, coverage, and evidence references
6. AI gateway contract:
   - single backend `/ai` API surface for ontology/process/RCA AI interactions plus generic assistant chat
   - generic assistant chat route: `POST /api/v1/ai/assistant/chat` with route/module context and policy metadata
   - module-scoped tool permissions are explicit in responses
   - analytical responses must include evidence and caveats

## Architectural Invariants

The following invariants are deliberate and must hold unless explicitly changed in `VISION.md`.

1. Seer is a monorepo with backend, UI, runtime composition, and docs co-located.
2. Backend is Python; frontend is React + Next.js (bootstrapped with `create-next-app` conventions).
3. Ontology authoring is outside Seer; Seer only ingests/validates/upserts ontology definitions.
4. Ontology UI is read-only.
5. SHACL validation is mandatory for ontology ingestion.
6. History storage is immutable and historical (not "latest-state only").
7. Core MVP data model consists of exactly three core history tables (`event_history`, `object_history`, `event_object_links`).
8. `event_id` is UUID.
9. `object_history_id` is UUID.
10. `event_object_links` references specific object history snapshots via `object_history_id`.
11. `object_type` is present in both `object_history` and `event_object_links`, and must match for linked records.
12. Object reference normalization preserves raw reference and derived canonical/hash forms.
13. Primary mining method for this phase is object-centric Petri nets.
14. Analytics data access uses programmatic SQL with Arrow-backed dataframe flow from ClickHouse into Python.
15. RCA outcome definition is analysis-run scoped (user or AI configured), not globally fixed.
16. AI interactions are served through a unified backend gateway with module-scoped permissions.
17. Analytical AI outputs (process/RCA) include explicit evidence and caveats; informational ontology Q&A may be concise.
18. Multi-tenant data-layer design is out of current architecture scope.
19. Heavy reliability subsystems (replay/dead-letter/schema-version governance) are intentionally out of current scope.
20. Governance/trust-center modules are intentionally out of current scope.
21. Ontology concept index responses for UI exploration exclude Prophet base concepts and non-graph concept categories.
22. Ontology graph views are limited to object/action/event/trigger concepts; property and custom-type concepts are excluded from graph navigation.
23. User-visible field label, state label, and field-value display policy in inspector flows is centralized in the shared UI ontology display layer (`seer-ui/app/lib/ontology-display/`), not page-local fallback chains.

## Boundaries and Dependency Direction

1. `seer-ui/` depends on backend APIs; backend never depends on UI implementation details.
2. ontology services depend on Fuseki + SHACL tooling; they do not depend on UI concerns.
3. analytics services depend on history/query interfaces and `pm4py`; they do not mutate ontology state.
4. AI orchestration depends on tool interfaces exposed by ontology/analytics domains; it should not bypass domain service boundaries.
5. runtime/deployment configuration in `docker/` composes services but does not contain domain logic.

## Cross-Cutting Concerns

### Validation and Correctness

1. ontology correctness gates are enforced at ingest time with SHACL.
2. ingestion correctness gates include required-field validation, UUID validation, and duplicate event rejection.
3. normalization correctness gates include deterministic canonicalization and hash stability for object references.

### Performance and Resource Boundaries

1. analysis runs require explicit anchors (object type, time window, depth, outcome) to avoid unbounded scans.
2. process mining and RCA should prefer bounded queries and progressive drill-down.

### Observability

1. backend services should emit structured logs with correlation identifiers where available.
2. analytics runs should record key run parameters and output summary metrics for traceability.

### Testing Strategy (Boundary-Oriented)

1. contract tests at API boundaries (ontology ingest, ingestion, analytics outputs).
2. domain tests for normalization, table-write semantics, and RCA scoring logic.
3. representative end-to-end tests across backend + storage + UI query paths for MVP-critical flows.

### Documentation and Planning Discipline

1. this file captures stable architecture only.
2. detailed execution sequencing belongs in active execution plans under `docs/exec-plans/active/`.
3. structural or invariant changes must be reflected in `VISION.md`, then propagated here.
