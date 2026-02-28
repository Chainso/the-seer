# DESIGN

This document is the top-level design map.

## Purpose

Capture design-level decisions that sit between product vision and concrete architecture.

## Canonical References

1. Product direction: `VISION.md`
2. Architecture map: `ARCHITECTURE.md`
3. Deep design notes: `docs/design-docs/index.md`
4. Execution plans: `docs/exec-plans/active/`

## Current Design Themes

1. Ontology is consumed in Seer as read-only semantic context (authoring in Prophet).
2. Event/object/link history is first-class and immutable.
3. UUID-based identities are required for event and object history records.
4. Object-centric process mining is implemented in Python with `pm4py`.
5. RCA uses a pluggable extraction layer plus ranking methods.
6. AI UX uses a shared backend gateway with module-scoped permissions and policy-aware evidence/caveat rendering.
7. Ontology concept discovery for explorer workflows is backend-filtered to user-graph concepts and graph-safe categories only.
8. User-visible field/state display in inspector flows is centralized in a shared ontology display layer (ontology-first, consistent fallbacks).
9. Interactive agent conversations in Seer UI are implemented with `assistant-ui` as the standard frontend conversation/runtime framework across assistant surfaces.
10. Seer UI components are built on Radix UI primitives as the standard accessibility and interaction foundation for reusable frontend components.

## Design Docs Index

See `docs/design-docs/index.md`.
