# Execution Plans

This directory is the canonical location for execution tracking artifacts.

`PLANS.md` at the repository root is the canonical source for what an execution plan must contain and how it must be maintained.

## Layout

- `active/` - plans currently in progress
- `active/index.md` - ordered execution sequence and handoff expectations
- `completed/` - plans that are finished
- `tech-debt-tracker.md` - ongoing debt inventory

## Workflow

1. Read `PLANS.md` before authoring or materially revising an execution plan.
2. Create plan in `active/`.
3. Use the `plan-and-execute` skill (`.agent/skills/plan-and-execute/SKILL.md`) when work needs a plan plus execution in one flow.
4. Update the plan as work progresses; keep the required living sections current.
5. Move plan to `completed/` when acceptance criteria are met and recorded.
