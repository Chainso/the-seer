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
6. AI UX starts with ontology copilot and expands to process/RCA workflows.

## Design Docs Index

See `docs/design-docs/index.md`.
