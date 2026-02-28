# Execution Plans

This directory is the canonical location for execution tracking artifacts.

## Layout

- `active/` - plans currently in progress
- `active/index.md` - ordered execution sequence and handoff expectations
- `completed/` - plans that are finished
- `tech-debt-tracker.md` - ongoing debt inventory

## Workflow

1. Create plan in `active/`.
2. Use the `plan-and-execute` skill (`.agent/skills/plan-and-execute/SKILL.md`) when work needs a plan plus execution in one flow.
3. Update plan as work progresses.
4. Move plan to `completed/` when acceptance criteria are met.
