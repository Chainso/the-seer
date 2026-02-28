# AGENTS

Purpose: this file is the entry map for repository knowledge.

Treat this file as a table of contents, not an encyclopedia. Start here, then load only the smallest set of docs needed for the task.

## Canonical Sources (In Order)

1. `VISION.md`
2. `DESIGN.md`
3. `ARCHITECTURE.md`
4. `docs/design-docs/index.md`
5. `docs/product-specs/index.md`
6. `docs/exec-plans/active/`
7. `docs/exec-plans/completed/`
8. `docs/exec-plans/tech-debt-tracker.md`

## Operating Model

1. Repository markdown is the system of record for product, design, architecture, and execution state.
2. External context (chat, memory, ad hoc notes) is non-authoritative unless captured in-repo.
3. Keep docs short, cross-linked, and layered for progressive disclosure.
4. If it is important for future execution, encode it into repository docs.

## Delivery Stance

1. Do not preserve legacy UI or backend behavior for backward compatibility by default.
2. Optimize for the best current user experience, backend contract clarity, and product correctness, even when that breaks legacy implementation patterns.
3. Treat legacy behavior as migration context, not a binding constraint.

## Read Order by Task Type

1. Product scope or priorities: `VISION.md`, then active execution plans.
2. Technical approach and boundaries: `DESIGN.md`, then `ARCHITECTURE.md`.
3. Deep design decisions: `docs/design-docs/index.md`, then selected topic docs.
4. User-facing behavior and acceptance: `docs/product-specs/index.md`, then specific spec.
5. Delivery status and sequencing: `docs/exec-plans/active/`.

## Execution Plan Lifecycle

1. Multi-step work must have a checked-in plan under `docs/exec-plans/active/`.
2. Active plans are living documents; update progress and decision log during execution.
3. Plan completion requires acceptance criteria to be met and recorded.
4. Completed plans move to `docs/exec-plans/completed/`.
5. Known gaps or intentionally deferred work go to `docs/exec-plans/tech-debt-tracker.md`.

## Documentation Update Matrix

When behavior changes, update the matching source of truth in the same change:

1. Product goals, scope, module intent: `VISION.md`.
2. Design choices, tradeoffs, interaction patterns: `DESIGN.md` or `docs/design-docs/*`.
3. System boundaries, invariants, dependency direction: `ARCHITECTURE.md`.
4. User flows and acceptance expectations: `docs/product-specs/*`.
5. Milestones, sequencing, execution status: `docs/exec-plans/active/*`.
6. Deferred cleanup or known limitations: `docs/exec-plans/tech-debt-tracker.md`.

## PR/Change Enforcement Checklist

Every meaningful change should satisfy this checklist:

1. Docs impact evaluated: either docs updated or explicitly marked "no-doc-impact" with reason.
2. Any changed invariant is reflected in `ARCHITECTURE.md` and aligned with `VISION.md`.
3. Any execution status change is reflected in the relevant active/completed plan.
4. Index files remain accurate when docs are added, renamed, or moved.
5. Links and references in touched docs remain valid.

## Commit Message Standard

1. Commit subject must state what changed in clear, concrete terms.
2. Commit body is required for non-trivial changes.
3. Commit body should be high-level but detailed enough to explain:
   - what was implemented or modified,
   - why the change was made,
   - key impact areas (API, data model, UI, docs, ops) when relevant.
4. Avoid vague subjects like "updates", "fix stuff", or "misc changes".
5. Prefer commit messages that are understandable without opening the diff.

## Mechanical Enforcement Intent

These checks should be automated as repository tooling matures:

1. Validate required docs exist and core indexes reference current files.
2. Flag broken internal markdown links.
3. Flag plans in `active/` with stale status/progress metadata.
4. Flag specs/design docs not indexed by their corresponding index files.
5. Run recurring doc-gardening passes to reduce stale guidance drift.

## Structural Invariants

1. Seer is a monorepo.
2. Backend, frontend, and runtime infrastructure live in this repository.
3. Ontology authoring is config-as-code in Prophet; Seer UI remains read-only for ontology.

## Repository Layout Intent

1. `docker/`
2. `seer-backend/`
3. `seer-ui/`
4. `docs/design-docs/`
5. `docs/exec-plans/`
6. `docs/product-specs/`

## Agent Skills

1. Skills are loaded from `.agent/skills` (symlink to `.agents/skills`).
2. Use `plan-and-execute` when a request asks to plan work and execute it end-to-end.
3. For multi-phase execution, pair `plan-and-execute` with execution-plan docs under `docs/exec-plans/active/`.
