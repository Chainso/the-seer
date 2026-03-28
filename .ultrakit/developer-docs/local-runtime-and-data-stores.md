# Local Runtime And Data Stores

## Purpose

Describe the local runtime composition, configuration model, and data-store responsibilities that support the current Seer architecture.

This doc is for engineers bringing the stack up locally or reasoning about which subsystem depends on which store.

## Runtime Composition

The repository uses local composition rather than hiding infrastructure behind a remote shared environment.

At a high level, the runtime contains:

1. the Next.js UI,
2. the Python backend,
3. Fuseki for ontology state,
4. ClickHouse for immutable history and transcript-oriented analytics data,
5. PostgreSQL for the generic action control plane,
6. and supporting dev scripts and compose entrypoints at the repository root.

The `docker/` folder is intentionally light. The runtime entrypoints live primarily in root compose files and scripts rather than in a large per-service Docker-doc subtree.

## Store Ownership

### Fuseki

Owns ontology graphs and current-release metadata.

Use Fuseki when the data is:

1. RDF-native,
2. release-scoped,
3. concept-relationship oriented,
4. or part of constrained managed-agent ontology authoring.

### ClickHouse

Owns immutable evidence and transcript-oriented analytical state.

Use ClickHouse when the data is:

1. append-only event history,
2. object snapshot history,
3. event-object linkage,
4. process-mining source data,
5. root-cause source data,
6. or canonical managed-agent completion-message persistence.

### PostgreSQL

Owns durable generic execution lifecycle state.

Use PostgreSQL when the data is:

1. queue/control-plane state,
2. lease ownership,
3. retry/dead-letter lifecycle state,
4. or instance heartbeat metadata.

## Configuration Model

Backend runtime configuration is centralized in `seer_backend.config.settings.Settings`.

That model covers:

1. API host/prefix,
2. Fuseki connection details,
3. ClickHouse connection and guardrail settings,
4. PostgreSQL action-store settings,
5. managed-agent runner behavior,
6. OpenAI runtime details,
7. and assistant skill directory discovery.

The key architectural point is that service construction reads from one settings model rather than each domain inventing its own environment contract.

## Bootstrap Pattern

Services initialize lazily or at app startup, then expose a stable domain-service surface through FastAPI app state.

Important implications:

1. schema creation and service availability are domain-specific responsibilities,
2. unavailable dependencies degrade into explicit unavailable-service behavior,
3. and initialization failures should remain visible at the service boundary rather than being hidden in transport code.

## ClickHouse Access Pattern

ClickHouse access is standardized through the shared async wrapper over the SQLAlchemy `clickhousedb` core client.

This keeps:

1. connection behavior centralized,
2. timeouts and compression consistently configured,
3. and repository implementations aligned on one execution path.

## Risks Of Misunderstanding

1. Treating ClickHouse as a mutable transactional system leads to incorrect lifecycle assumptions.
2. Treating PostgreSQL as the source of truth for analytical evidence blurs the history-versus-control-plane split.
3. Treating Fuseki as a general application database obscures its role as ontology and capability storage.
4. Duplicating env parsing across domains weakens boot-time consistency and service construction.

## Extension Guidance

1. Choose the store based on ownership semantics first, not convenience.
2. Add new settings to the centralized backend settings model when they affect runtime construction.
3. Prefer shared client wrappers and repository patterns over per-domain connection logic.
4. Update this doc when service/store ownership changes, not when an individual environment variable is renamed.
