# Ontology, History, And Catalog

## Purpose

Describe how Seer combines ontology state, immutable operational history, and catalog read models into one coherent evidence layer.

This doc is for engineers who need to understand where business meaning comes from, where runtime evidence comes from, and how the catalog experience bridges the two.

## Three Layers

### Ontology Layer

The ontology defines business meaning and executable capability metadata.

It answers questions such as:

1. what kinds of objects, actions, events, and triggers exist,
2. how actions accept input and produce events,
3. and which managed-agent definitions Seer is allowed to author.

Ontology state lives in Fuseki as named graphs with an explicit current-release pointer.

### History Layer

History is immutable evidence stored in ClickHouse.

It records:

1. events,
2. object snapshots over time,
3. explicit event-object links,
4. and produced-event provenance from execution flows.

This layer is append-only and is the source of truth for runtime evidence.

### Catalog Layer

Catalog is the read model that combines ontology meaning with runtime evidence.

It answers product-facing questions such as:

1. what this concept is,
2. how it relates to other concepts,
3. what runtime activity exists for it,
4. and how it connects to actions, triggers, events, or objects.

Catalog does not own durable state. It composes ontology, history, and action reads into a single user-facing contract.

## Why The Split Matters

Ontology and history solve different problems.

Ontology says what a thing means. History says what actually happened. Catalog is valuable because it presents both without forcing the user into raw RDF or raw event-log tooling.

## Release And Pointer Semantics

The ontology domain maintains:

1. a base graph,
2. release graphs,
3. a metadata graph that points at the current release,
4. and a dedicated Seer data graph for constrained managed-agent authoring.

This keeps ontology release selection explicit and prevents runtime features from silently depending on a mutable in-memory schema.

## History Storage Semantics

History normalizes object references and links events to concrete object snapshots.

That design supports:

1. timeline reconstruction,
2. latest-object queries,
3. catalog runtime views,
4. analytics execution,
5. and produced-event provenance for managed-agent and action inspection.

## Catalog Read-Model Composition

CatalogService builds a temporary in-memory index by:

1. reading ontology concepts and descriptions,
2. deriving relationships between objects, actions, events, and triggers,
3. and enriching detail views with history reads and action-run visibility.

The important point is that catalog is not a separately modeled domain object graph persisted in its own database.

## Risks Of Misunderstanding

1. Treating ontology as runtime evidence leads to stale or purely descriptive UI.
2. Treating history as self-describing business meaning leads to weak concept presentation and brittle labeling.
3. Treating catalog as a third persistence system creates unnecessary duplication and drift.
4. Ignoring ontology release-pointer semantics makes action validation and concept discovery inconsistent across the stack.

## Extension Guidance

1. Put new business meaning into ontology, not into ad hoc UI enums or duplicated backend tables.
2. Put new operational evidence into immutable history, not into catalog-specific storage.
3. Add new catalog screens only when they can be expressed as composition over existing ontology, history, and action contracts.
4. Update this doc when the data ownership split changes, not when a specific query or field list changes.
