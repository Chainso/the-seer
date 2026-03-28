# Developer Docs Index

## Purpose

Provide the stable internal architecture map that sits below `ARCHITECTURE.md` and above source-code spelunking.

Use these docs when a new engineer needs the mental model for how Seer is assembled, where state lives, and which subsystems own which responsibilities.

## Read Order

1. `backend-domain-map.md`
2. `ontology-history-and-catalog.md`
3. `local-runtime-and-data-stores.md`
4. `ui-surface-architecture.md`
5. `assistant-actions-and-managed-agents.md`

## Docs

1. `backend-domain-map.md`
   - Backend composition, domain boundaries, transport-versus-service layering, and ownership of the major backend packages.
2. `ontology-history-and-catalog.md`
   - How ontology meaning, immutable evidence, and catalog read models fit together without duplicating storage ownership.
3. `local-runtime-and-data-stores.md`
   - Local stack composition, store responsibilities, configuration, and bootstrap behavior.
4. `ui-surface-architecture.md`
   - Shared shell, major UI surfaces, assistant runtime shape, and the backend adapter boundary in the Next.js app.
5. `assistant-actions-and-managed-agents.md`
   - How assistant investigation, generic actions, and managed-agent orchestration share runtime infrastructure while keeping clear ownership boundaries.

## Relationship To Canonical Docs

1. `VISION.md` explains what Seer is for.
2. `DESIGN.md` explains product and interaction direction.
3. `ARCHITECTURE.md` defines the top-level boundaries and invariants.
4. This folder explains the stable subsystem-level shape of the code that implements those boundaries.

## Writing Bar

1. Document components, contracts, dependency direction, and data ownership.
2. Avoid endpoint-by-endpoint inventories, class-by-class walkthroughs, or transient refactor details.
3. Update these docs when a new engineer would otherwise get the wrong architectural mental model.
