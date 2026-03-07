# DESIGN

This document is the top-level design map for Seer.

It sits between product strategy and implementation architecture.

For a new reader, the shortest useful summary is:

1. Prophet defines the business world and capability catalog.
2. Seer stores operational evidence over time.
3. AI is the default investigation interface.
4. Managed agents execute ontology-defined workflows inside a safe runtime.

## Canonical References

1. Product direction: `VISION.md`
2. Architecture map: `ARCHITECTURE.md`
3. Deep design notes: `docs/design-docs/index.md`
4. Execution plans: `docs/exec-plans/active/`

## Current Design Themes

1. Ontology is consumed in Seer as read-only semantic context and executable capability catalog; authoring remains in Prophet.
2. Seer extends Prophet with execution concepts for managed AI workflows rather than inventing a disconnected action model.
3. Event, object, and relationship history are first-class and immutable evidence for both investigation and execution.
4. AI investigation is the primary user-facing analytics experience; process mining and RCA are tools and drill-down surfaces, not the default entry point.
5. Managed agentic workflows are ontology-defined workflows/actions executed by Seer in a bounded runtime rather than compiled into rigid workflow specs.
6. Safe execution is a core design problem: runtime guardrails, budgets, auditability, and idempotent action semantics must be explicit even before platform authz is designed.
7. User-visible evidence and caveats are required for analytical and agent-driven conclusions.
8. The ontology remains the single capability catalog; Seer should not introduce a separate action registry concept.
9. User-visible field/state display in inspector and investigation flows remains centralized in a shared ontology display layer.
10. Interactive agent conversations in Seer UI use `assistant-ui` as the standard frontend conversation/runtime framework across assistant surfaces.
11. Seer UI components are built on Radix UI primitives as the standard accessibility and interaction foundation for reusable frontend components.
12. The shared Seer shell is responsive by default, but shell affordances should stay subordinate to the primary investigation and managed-agent experiences.

## Design Docs Index

See `docs/design-docs/index.md`.
