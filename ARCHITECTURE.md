# ARCHITECTURE

This document is the high-level architecture map for Seer.

It is intentionally stable and coarse-grained. It answers:

1. where major responsibilities live,
2. where system boundaries are,
3. and which architectural invariants must remain true.

For product direction, see `VISION.md`.

## Bird's-Eye View

Seer is organized around four architectural planes:

1. ontology and capability definition,
2. immutable operational history,
3. AI-first investigation,
4. managed action control and agent orchestration.

Seer ingests:

1. ontology definitions from Prophet local Turtle output and Seer ontology extensions,
2. operational events with object snapshots and references,
3. and action or agent execution activity.

Seer stores:

1. ontology state in Fuseki named graphs,
2. immutable event/object/link histories plus canonical agent transcript `completion_messages` in ClickHouse,
3. durable generic action control-plane state in PostgreSQL.

Seer computes:

1. AI investigation responses grounded in ontology and history,
2. process-mining outputs,
3. ranked root-cause insight hypotheses,
4. and managed-agent execution decisions and audits.

Seer presents:

1. AI-first investigation experiences,
2. managed-agent execution visibility and operations surfaces,
3. expert drill-down surfaces for ontology, history, process, and RCA,
4. and operator visibility into runs, guardrails, and outcomes.

## Top-Level System Map

1. `seer-ui/`: React + Next.js application for AI investigation, managed-agent execution visibility, and expert drill-down surfaces.
2. `seer-backend/`: Python API and orchestration for ontology ingestion, history ingestion, analytics, action execution, and managed-agent runtime behavior.
3. `docker/`: local composition for backend, UI, Fuseki, ClickHouse, PostgreSQL, and supporting runtime dependencies.
4. `prophet/`: upstream Prophet assets used as ontology authoring source and base metamodel context.
5. `docs/`: system-of-record documentation, design records, specs, and execution plans.

## Code Map

### `seer-ui/` (Experience Layer)

Primary responsibilities:

1. AI-first investigation experiences.
2. Managed-agent run visibility, trusted-mode inspection controls, and operator surfaces.
3. Expert drill-down over ontology, history, process, and RCA evidence.
4. Unified assistant experience across shell and dedicated assistant surfaces.
5. Dedicated `/assistant` conversation shell with an attached optional artifact canvas.

Expected internal areas:

1. route/application structure (`app` with Next.js App Router),
2. reusable UI components (`components`),
3. backend and AI client adapters (`lib` / service adapters),
4. visualization modules used for evidence drill-down and expert validation.

Architectural boundary:

- UI remains read-only for ontology authoring and should not become a general-purpose workflow compiler/editor.

### `seer-backend/` (System Core)

Primary responsibilities:

1. HTTP API boundary for UI, executors, and ingestion clients.
2. ontology ingestion, validation, query, and capability discovery.
3. event ingestion and history persistence.
4. process mining and root-cause analysis execution.
5. AI investigation orchestration.
6. action orchestration control plane.
7. managed-agent runtime orchestration and execution safety enforcement.

Expected internal service areas:

1. `ontology` domain:
   - Turtle ingestion
   - SHACL validation against Prophet and Seer extension contracts
   - Fuseki named-graph upsert
   - read-only SPARQL query service
   - concept and capability index/list APIs for UI and AI context
2. `history` domain:
   - event parsing and validation
   - writes to `event_history`, `object_history`, `event_object_links`
   - object reference normalization utilities
   - history query APIs for investigation and execution
3. `analytics` domain:
   - ClickHouse extraction (Arrow-backed dataframe path)
   - object-centric process mining via `pm4py`
   - root-cause pipeline (neighborhood extraction + ranking)
4. `ai` domain:
   - unified AI gateway for ontology, investigation, process, RCA, and managed-agent reasoning tools
   - canonical `completion_messages` assistant runtime for `/assistant`
   - tool access and runtime-guardrail enforcement
   - evidence and caveat packaging
   - SSE-first assistant/investigation streaming orchestration
   - backend-owned assistant skill catalog under `seer-backend/src/seer_backend/ai/assistant_skills/`
   - tool-driven artifact and canvas contracts for assistant-presented visuals
5. `actions` domain:
   - ontology-backed submit validation and enqueue semantics
   - pull-based claim + lease assignment
   - completion/failure lifecycle callbacks
   - status query/list/SSE contracts
6. `agent_orchestration` domain:
   - LLM-backed execution for ontology-defined `seer:AgenticWorkflow` runs
   - canonical agent transcript persistence and resume from saved `completion_messages`
   - runtime tool policy (`load_skill` limited to deep ontology, object store, and object history, plus `load_action`)
   - dedicated agentic workflow execution list/detail/message/SSE APIs
   - audit-oriented run detail composed from generic actions plus produced-event history
7. `api` / `transport` domain:
   - request/response contracts
   - endpoint composition

Architecture boundary:

- backend owns all state mutation and execution governance; UI consumes backend contracts.

### `docker/` (Runtime Composition)

Primary responsibilities:

1. deterministic local environment startup,
2. service wiring, network configuration, and environment defaults,
3. reproducible developer runtime for current Seer architecture.

### `prophet/` (Authoring Source Boundary)

Primary responsibilities relative to Seer:

1. provide ontology authoring and base metamodel context,
2. provide local ontology output consumed by Seer,
3. provide base `Action` / `Workflow` / `Event` / `Trigger` semantics that Seer extends rather than replaces.

Architecture boundary:

- Seer consumes Prophet outputs; Seer does not become the ontology authoring platform.

### `docs/` (Repository Knowledge System)

Primary responsibilities:

1. encode product, design, architecture, and execution decisions in-repo,
2. maintain active/completed execution plans and technical debt tracking,
3. provide agent- and human-legible system context.

## Architectural Planes

### Ontology Plane

Stack: RDFLib + SPARQL over Fuseki.

Flow:

1. ingest local ontology Turtle,
2. validate against Prophet plus Seer execution constraints,
3. upsert into named graphs,
4. expose read/query interfaces for UI, AI investigation, and managed execution.

Design intent:

- the ontology is both the business meaning layer and the executable capability catalog.
- Seer extends Prophet with `seer:AgenticWorkflow`, which remains a subtype of `prophet:Workflow` rather than a parallel capability model.

### History Plane

Stack: ClickHouse core immutable history tables plus agent transcript storage.

Core tables:

1. `event_history`
2. `object_history`
3. `event_object_links`
4. `agentic_workflow_completion_messages`

Design intent:

- keep complete histories and canonical agent transcript state so AI, analytics, and execution inspection can reason about actual operational state over time.

### Analytics Plane

Stack: Python analytics services + `pm4py`.

Flow:

1. query ClickHouse programmatically,
2. load Arrow-backed dataframes,
3. run process mining and RCA methods,
4. return structured evidence contracts for AI and UI surfaces.

Design intent:

- process mining and RCA are reusable reasoning tools, not isolated product silos.

### AI Investigation Plane

Stack: backend AI gateway + ontology/history/analytics tools.

Flow:

1. interpret user question,
2. gather ontology and history context,
3. call analytical tools when useful,
4. synthesize findings with evidence and caveats,
5. hand off to expert drill-down or recommended execution paths.

Design intent:

- the primary analytics interaction is AI-led investigation, not manual configuration-first analysis.

### Action Control Plane And Agent Orchestration

Stack: Python action/orchestration services + SQLAlchemy Core + PostgreSQL plus ClickHouse transcript/history queries.

Flow:

1. discover ontology-defined executable capabilities,
2. validate action or agentic workflow invocation against current ontology metadata,
3. persist durable generic lifecycle state in PostgreSQL,
4. persist canonical agent transcript `completion_messages` in ClickHouse,
5. enforce lease ownership, runtime tool policy, and execution safety,
6. expose canonical status, lineage, transcript, and audit contracts.

Design intent:

- Seer is responsible for safe execution, not for inventing a second capability model outside the ontology.
- `actions` remains the generic execution control plane, while `agent_orchestration` owns LLM-backed runs, transcript semantics, and dedicated execution APIs.

## Core Contracts

1. Ontology ingest contract:
   - input: Prophet local Turtle files plus Seer extension content
   - validation: SHACL against base and extension constraints
   - storage: URI-identity-driven upsert into Fuseki named graphs
2. Event history contract:
   - append-only event log with UUID `event_id`
3. Object history contract:
   - immutable snapshot log with UUID `object_history_id`
4. Event-object link contract:
   - explicit links from event UUIDs to concrete object snapshots
5. Investigation result contract:
   - AI-readable and UI-renderable findings with evidence, caveats, and recommended next actions
6. Process/RCA tool contract:
   - backend analytical tools callable by UI and AI orchestration paths
7. Action execution contract:
   - ontology-defined input validation, pull/lease execution, lifecycle visibility, lineage, and at-least-once delivery semantics
8. Agentic workflow execution contract:
   - ontology-defined `seer:AgenticWorkflow` identity extending `prophet:Workflow`
   - generic action execution rows with `action_kind=agentic_workflow`
   - canonical append-only transcript `completion_messages` stored in ClickHouse
   - runtime tool policy based on restricted `load_skill` plus `load_action`
   - dedicated execution list/detail/messages/stream APIs for inspection

## Architectural Invariants

The following invariants are deliberate and must hold unless explicitly changed in `VISION.md`.

1. Seer is a monorepo with backend, UI, runtime composition, Prophet assets, and docs co-located.
2. Backend is Python; frontend is React + Next.js.
3. Ontology authoring remains outside Seer; Seer ingests and validates ontology definitions.
4. The ontology is the executable capability catalog; Seer should not introduce a separate action catalog concept.
5. Managed agentic workflows are modeled as ontology-defined workflow/actions; `seer:AgenticWorkflow` extends `prophet:Workflow`.
6. SHACL validation is mandatory for ontology ingestion.
7. History storage is immutable and historical, not latest-state only.
8. The immutable operational history model centers on `event_history`, `object_history`, and `event_object_links`; ClickHouse also stores append-only agent transcript `completion_messages`.
9. `event_id` is UUID.
10. `object_history_id` is UUID.
11. `event_object_links` references specific object history snapshots via `object_history_id`.
12. Object reference normalization preserves raw reference and derived canonical/hash forms.
13. AI investigation is the primary analytics interaction model.
14. Process mining and RCA remain backend analytical tools and expert drill-down surfaces.
15. Analytical AI outputs include explicit evidence and caveats.
16. Generic action control-plane state is persisted in PostgreSQL; canonical agent transcript `completion_messages` are persisted in ClickHouse.
17. Every submitted action produces a backend-generated UUID `action_id`.
18. Submit-time ontology validation is mandatory for execution.
19. Action delivery remains pull-based claim with lease ownership and at-least-once semantics.
20. Duplicate action delivery is acceptable; side-effect dedupe is executor-owned and keyed by `action_id`.
21. Every agentic workflow execution is also a generic action execution, and child executions are linked through `parent_execution_id`.
22. Produced events may carry optional `produced_by_execution_id` provenance when runtime execution emitted them.
23. Backend owns execution governance, runtime guardrail enforcement, and audit trails for managed agents.
24. UI remains read-only for ontology definitions and should not become a general workflow compiler/editor.
25. Multi-tenant data-layer design is out of current architecture scope.
26. Governance/trust-center modules are intentionally out of current scope.

## Boundaries And Dependency Direction

1. `seer-ui/` depends on backend APIs; backend never depends on UI implementation details.
2. ontology services depend on Fuseki + SHACL tooling; they do not depend on UI concerns.
3. analytics services depend on history storage and analytical libraries; they do not define the canonical ontology model.
4. managed-agent runtime depends on ontology and history services plus action execution contracts; those services must not depend on UI presentation semantics.
5. documentation is the system of record for product/design/architecture intent; implementation follows those docs.
