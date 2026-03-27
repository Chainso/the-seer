# Execution Plans

This directory is the canonical location for execution tracking artifacts.

The [plan contract](plan-contract.md) defines what an execution plan must contain and how it must be maintained. Read it before authoring or materially revising a plan.

## Layout

- `plan-contract.md` — the canonical specification for execution plans
- `active/` — plans currently in progress
- `active/index.md` — ordered execution sequence
- `completed/` — plans that are finished
- `tech-debt-tracker.md` — ongoing debt inventory

## Workflow

1. Read `plan-contract.md` before creating a plan.
2. Create plan in `active/`.
3. Update `active/index.md` to register the plan.
4. Update the plan as work progresses; keep the required living sections current.
5. Move plan to `completed/` when acceptance criteria are met and recorded.
