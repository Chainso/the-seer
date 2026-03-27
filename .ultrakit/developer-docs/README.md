# Developer Documentation

Internal developer documentation for the project team. Covers architecture, runtime internals, and key design decisions.

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
