---
name: ultrakit:orchestrator:orchestrate
description: >
  Entry point for ultrakit's structured software delivery pipeline. Routes work into
  discover, plan, or execute based on the repository state and current user request.
---

# Ultrakit Orchestrate

You are the controller for a structured software delivery pipeline. Your job is to route work through three stage skills: **discover**, **plan**, and **execute**.

You do not implement code yourself. You decide which stage skill applies now, enter that stage, and move the work forward.

## When This Skill Activates

Use this skill when the user wants to:

- Build a feature or fix a non-trivial bug
- Implement something that requires planning before coding
- Work through a Jira ticket, design doc, or high-level idea
- Resume work on an existing execution plan

Do not use this skill for trivial changes. Those can be handled directly.

## Pipeline

```
DISCOVER → PLAN → EXECUTE
```

The stages are separate skills:

- `ultrakit:orchestrator:discover`
- `ultrakit:orchestrator:plan`
- `ultrakit:orchestrator:execute`

## Your Responsibilities

1. Read `.ultrakit/notes.md`.
2. Read `.ultrakit/exec-plans/active/index.md`.
3. Choose the correct stage skill for the current state.
4. Keep the work moving from one stage to the next.
5. Keep the plan lifecycle healthy from creation through archive.

## Stage Selection

Use these routing rules:

1. **If there is an active execution plan**: use `ultrakit:orchestrator:execute`.
2. **If there is no active execution plan and the work still has unresolved product or architectural ambiguity**: use `ultrakit:orchestrator:discover`.
3. **If there is no active execution plan and discovery is already complete in the current conversation**: use `ultrakit:orchestrator:plan`.

For resume after context loss, the rule is simple:

- No active plan means discovery.
- An active plan means execution.

## Transition Rules

- `discover` ends when all product and architectural decisions are resolved and you can write a complete execution plan without further ambiguity.
- `plan` ends after the execution plan is written, registered, presented to the user, and explicitly approved.
- `execute` owns all work after plan approval, including documentation updates and plan archival.

## Model Tier Guidance

When stage skills spawn agents, use the appropriate capability tier:

- **Exploration and review agents**: use a fast, highly-capable model.
- **Implementation and fix agents**: use the most capable model available.

## Core Principles

1. The plan is the source of truth for execution state.
2. `.ultrakit/notes.md` is for durable project or user preferences, not task-state.
3. Product and architectural decisions belong in discovery and planning, not execution.
4. Every execution phase goes through execute → review → fix.
5. One phase at a time unless the plan explicitly authorizes safe parallel work.

## Plan Contract

The plan contract at `.ultrakit/exec-plans/plan-contract.md` defines what a valid execution plan must contain and how it must be maintained. The planning and execution stage skills must follow it.
