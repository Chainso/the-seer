# Developer Documentation

Internal developer documentation for the project team. Covers architecture, runtime internals, and key design decisions.

Start with `index.md` in this directory for the current document map.

## Who This Is For

Software engineers working on or integrating with this system. This is NOT user-facing documentation.

## Maintenance Guidelines

This documentation focuses on **architecture, contracts, and design rationale** — knowledge that stays relevant for months or years. It describes how the system works and why, not what changed in the last commit.

**The test for updating:** Would a new team member reading these docs get a wrong mental model of the system after this change? If yes, update. If no, skip.

**Update these docs when:**

- A new system component is added or an existing one is removed
- A contract between components changes (APIs, wire formats, schemas, protocols)
- A major architecture decision is made or reversed
- The boundary between components shifts (logic moves from one module to another)
- A new runtime, language, or deployment topology is added

**Do not update for:**

- Internal refactors that do not change component boundaries or contracts
- Dependency bumps, version changes, or tooling upgrades
- Test changes, fixture updates, or CI configuration
- Bug fixes that do not alter how components interact
- New features that fit within already-documented architecture patterns
- Phase-by-phase implementation details (those belong in execution plans)

When in doubt, err on the side of not updating. These docs should be stable enough that reading them once gives someone a correct understanding for months of work.

## Docs In This Folder

1. [backend-domain-map.md](./backend-domain-map.md) - backend service boundaries, domain ownership, and API composition.
2. [ui-surface-architecture.md](./ui-surface-architecture.md) - shared shell, surface organization, assistant runtime usage, and UI-to-backend boundaries.
3. [ontology-history-and-catalog.md](./ontology-history-and-catalog.md) - how ontology state, immutable history, and catalog read models fit together.
4. [assistant-actions-and-managed-agents.md](./assistant-actions-and-managed-agents.md) - how assistant investigation, generic action execution, and managed-agent orchestration share runtime infrastructure.
5. [local-runtime-and-data-stores.md](./local-runtime-and-data-stores.md) - local composition, data stores, configuration, and service bootstrapping.

## How To Read This Folder

1. Start with `ARCHITECTURE.md` for the repository-wide map.
2. Use this folder when you need a deeper mental model of one subsystem boundary.
3. Prefer the smallest relevant doc rather than reading this folder end to end.
4. Keep cross-links current when adding or renaming docs in this folder.
