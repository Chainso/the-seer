# Backend Domain Map

## Purpose

Describe the stable backend domains in `seer-backend/` and the boundaries between transport, orchestration, persistence, and runtime governance.

This doc is for engineers who need to understand where new backend behavior belongs and which service owns a given contract.

## Entry Points

The backend starts in `seer_backend.main:create_app`.

That app is responsible for:

1. loading `Settings`,
2. configuring logging,
3. constructing service singletons,
4. attaching them to FastAPI app state,
5. and mounting the API routers under the shared API prefix.

The transport layer in `seer_backend/api/` stays thin. Its job is request validation, HTTP error mapping, and routing into domain services.

## Domain Ownership

### `ontology`

Owns ontology ingest, read-only query, release-pointer semantics, and constrained managed-agent authoring into the dedicated Seer data graph.

This domain is the source of truth for:

1. executable capability discovery,
2. concept and relationship reads,
3. ontology release selection,
4. and the managed-agent definitions Seer is allowed to write.

### `history`

Owns immutable event, object, and event-object-link persistence in ClickHouse.

This domain is the source of truth for:

1. event ingestion,
2. object timeline reads,
3. latest-object lookups,
4. and event/object relationship queries used by UI, analytics, and execution inspection.

### `analytics`

Owns ClickHouse-native process-mining and root-cause execution.

It consumes immutable history and produces structured evidence payloads rather than becoming a separate persistence system.

### `catalog`

Owns the catalog read model.

It does not persist its own state. Instead, it composes ontology, history, and action services into the read contracts that power catalog browsing and detail screens.

### `actions`

Owns generic action submission, validation against ontology contracts, leasing, lifecycle callbacks, and retry/dead-letter semantics.

This is the generic execution control plane. It is not specific to managed agents.

### `agent_orchestration`

Owns managed-agent transcript persistence, execution detail composition, and the Seer-owned runtime behavior for ontology-defined managed agents.

This domain extends the generic actions plane rather than replacing it.

### `ai`

Owns the shared AI gateway, assistant/workbench request contracts, assistant skill loading, runtime mode differences, and artifact/canvas-oriented response packaging.

It coordinates ontology, history, and analytics capabilities, but the underlying business data contracts remain owned by those domains.

## Service Composition Pattern

The backend uses a consistent layering model:

1. router in `api/` defines transport contract,
2. service in the domain package owns orchestration and validation,
3. repository or external client owns storage access,
4. models define durable or transport-facing payloads.

The important boundary is that routers should not accumulate domain logic, and UI clients should not bypass backend-owned orchestration.

## Cross-Domain Contracts

### Ontology As Capability Registry

`actions` validates submissions by querying ontology state for the executable action contract. Backend execution is therefore coupled to the current ontology release, not to a duplicated action schema in PostgreSQL.

### History As Evidence Layer

`analytics`, `catalog`, and `agent_orchestration` all depend on history reads. None of them own separate event/object truth.

### Actions As Generic Lifecycle Plane

Managed-agent runs are still action records. `agent_orchestration` adds transcript and audit composition, but lifecycle, leasing, and retry semantics stay in `actions`.

### AI As Orchestrator, Not Source Of Truth

The AI layer interprets, packages, and streams results. It should not become the canonical owner of ontology state, history state, or execution state.

## Risks Of Misunderstanding

1. Treating `catalog` as a persistence layer instead of a read-model composition layer leads to duplicated contracts.
2. Treating `agent_orchestration` as a separate execution platform obscures that managed-agent runs still flow through the generic `actions` control plane.
3. Pushing domain logic into `api/` makes transport contracts unstable and harder to test.
4. Treating `ai` as a general backend facade blurs ownership of validation and durable state.

## Extension Guidance

1. Add a new backend feature to an existing domain if it fits an established contract boundary.
2. Add a new domain only when ownership, persistence, or lifecycle semantics materially differ.
3. Keep new transport endpoints thin and route them into an existing service when possible.
4. Update `ARCHITECTURE.md` if a new component changes the repository-level system map, not just this deeper domain map.
