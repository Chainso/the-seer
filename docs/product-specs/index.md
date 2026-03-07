# Product Specs Index

## Purpose

Catalog user-facing product specs and make implementation state obvious.

## How To Read This Index

1. `completed` means the spec describes behavior that has already been delivered or ratified.
2. `draft` means the spec captures intended product behavior that is not yet implemented end-to-end.
3. If a draft spec moves into active delivery, the relevant execution plan under `docs/exec-plans/active/` should be the canonical place to track implementation progress.
4. If there are no active execution plans for a draft spec, treat it as product direction only, not in-flight implementation.

## Implemented Specs

1. `foundation-module-shell-phase-0.md` - completed
2. `new-user-onboarding.md` - completed
3. `process-explorer-phase-3.md` - completed
4. `root-cause-lab-phase-4.md` - completed
5. `ai-guided-investigation-phase-5.md` - completed
6. `ui-experience-replatform-phase-f-hardening-rollout.md` - completed
7. `history-inspector-phase-3a.md` - completed
8. `action-orchestration-backend-service.md` - completed
9. `ai-investigation-workbench.md` - completed (`delivered workbench snapshot; active `/assistant` supersession tracked separately`)

## Draft Specs

1. `managed-agentic-workflows.md` - draft (`not implemented yet`)
2. `managed-agent-controls-and-approvals.md` - draft (`Managed Agent Runtime Controls`, `not implemented yet`)

## Current Implementation Gaps

1. `managed-agentic-workflows.md`
2. `managed-agent-controls-and-approvals.md`

Current active execution coverage:

1. `ai-investigation-workbench.md` -> `docs/exec-plans/active/assistant-conversation-canvas-and-skills.md` (`assistant/canvas/skills supersession track`; Phase 0 complete, Phase 1 contract unification next)

## Usage

1. Keep specs focused on user behavior and acceptance criteria.
2. Link specs to active execution plans where implementation is in progress.
