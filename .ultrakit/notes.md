# Notes

Agent-written observations about effective working patterns in this project. This file is updated during the documentation phase of each execution plan based on what the agent observed.

These notes help future agents work effectively without rediscovering project-specific knowledge from scratch.

## Guidelines

- Only record knowledge specific to THIS project that could not be known without working in it
- CLAUDE.md takes precedence — if a note contradicts CLAUDE.md, flag it to the user instead
- Keep concise — this should read as a tight cheat sheet, not a journal

## Seer Notes

- Seer is pre-launch. Backward compatibility is opt-in only when a spec, execution plan, or explicit user instruction requires it.
- Canonical docs for behavior and invariants remain `VISION.md`, `DESIGN.md`, `ARCHITECTURE.md`, and `docs/product-specs/*`; execution tracking now lives under `.ultrakit/exec-plans/`.
- The main delivery surfaces are `seer-backend/`, `seer-ui/`, and `prophet/`; Seer UI remains read-only for ontology authoring.
