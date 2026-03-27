# AGENTS

Purpose: this file is the entry map for repository knowledge.

Treat this file as a table of contents, not an encyclopedia. Start here, then load only the smallest set of docs needed for the task.

## Canonical Sources (In Order)

1. `VISION.md`
2. `DESIGN.md`
3. `ARCHITECTURE.md`
4. `.ultrakit/exec-plans/plan-contract.md`
5. `docs/design-docs/index.md`
6. `docs/product-specs/index.md`
7. `.ultrakit/exec-plans/active/`
8. `.ultrakit/exec-plans/completed/`
9. `.ultrakit/exec-plans/tech-debt-tracker.md`
10. `.ultrakit/notes.md`
11. `prophet/prophet.ttl`

## Operating Model

1. Repository markdown is the system of record for product, design, architecture, and execution state.
2. External context (chat, memory, ad hoc notes) is non-authoritative unless captured in-repo.
3. Keep docs short, cross-linked, and layered for progressive disclosure.
4. If it is important for future execution, encode it into repository docs.

## Delivery Stance

1. Seer is pre-launch. Existing code, docs, and behavior are iteration artifacts, not a public compatibility contract.
2. Do not preserve legacy UI or backend behavior for backward compatibility by default.
3. Backward compatibility is required only when a spec, execution plan, or explicit user instruction says it is required.
4. Optimize for the best current user experience, backend contract clarity, and product correctness, even when that breaks legacy implementation patterns.
5. Treat legacy behavior as migration context, not a binding constraint.
6. Prefer deleting, replacing, or simplifying obsolete implementation patterns over carrying them forward for consistency with the current codebase.
7. Catalog is now the canonical user-facing discovery surface; `/catalog`, `/catalog/[kind]`, and `/catalog/[kind]/[catalogKey]` routes represent the published experience while `/ontology`, `/inspector/history`, `/inspector/insights`, and neighboring pages remain on disk only as deprecated retained surfaces.

## Read Order by Task Type

1. Product scope or priorities: `VISION.md`, then `prophet/prohet.ttl` then active execution plans.
2. Technical approach and boundaries: `DESIGN.md`, then `ARCHITECTURE.md`.
3. Deep design decisions: `docs/design-docs/index.md`, then selected topic docs.
4. User-facing behavior and acceptance: `docs/product-specs/index.md`, then specific spec.
5. Multi-step execution planning and plan maintenance: `.ultrakit/exec-plans/plan-contract.md`, then `.ultrakit/exec-plans/active/`.
6. Delivery status and sequencing: `.ultrakit/exec-plans/active/`.

## Execution Plan Lifecycle

1. Multi-step work must have a checked-in plan under `.ultrakit/exec-plans/active/`.
2. `.ultrakit/exec-plans/plan-contract.md` is the canonical contract for what an execution plan must contain and how it must be maintained.
3. Active plans are living documents; keep the contract's required sections current during execution.
4. Plan completion requires acceptance criteria to be met and recorded.
5. Completed plans move to `.ultrakit/exec-plans/completed/`.
6. Known gaps or intentionally deferred work go to `.ultrakit/exec-plans/tech-debt-tracker.md`.

## Documentation Update Matrix

When behavior changes, update the matching source of truth in the same change:

1. Product goals, scope, module intent: `VISION.md`.
2. Design choices, tradeoffs, interaction patterns: `DESIGN.md` or `docs/design-docs/*`.
3. System boundaries, invariants, dependency direction: `ARCHITECTURE.md`.
4. User flows and acceptance expectations: `docs/product-specs/*`.
5. Milestones, sequencing, execution status: `.ultrakit/exec-plans/active/*`.
6. Deferred cleanup or known limitations: `.ultrakit/exec-plans/tech-debt-tracker.md`.

## PR/Change Enforcement Checklist

Every meaningful change should satisfy this checklist:

1. Docs impact evaluated: either docs updated or explicitly marked "no-doc-impact" with reason.
2. Any changed invariant is reflected in `ARCHITECTURE.md` and aligned with `VISION.md`.
3. Any execution status change is reflected in the relevant active/completed plan.
4. Index files remain accurate when docs are added, renamed, or moved.
5. Links and references in touched docs remain valid.
6. Pre-launch status is respected: current implementation is not treated as a binding compatibility constraint unless explicitly designated otherwise.
7. Legacy-compatibility concessions are not assumed; if any are retained, they are explicitly justified.
8. UI and backend behavior changes document what legacy behavior was intentionally removed.

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
3. Flag plans in `.ultrakit/exec-plans/active/` that do not conform to `.ultrakit/exec-plans/plan-contract.md` or have stale status/progress metadata.
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
5. `.ultrakit/`
6. `docs/product-specs/`

## Agent Skills

1. Skills are loaded from `.agent/skills` (symlink to `.agents/skills`).
2. Use `ultrakit:orchestrator` for non-trivial work that needs discovery, planning, and execution.
3. `ultrakit:orchestrator` operates against `.ultrakit/exec-plans/plan-contract.md` and the relevant execution-plan docs under `.ultrakit/exec-plans/`.
4. Keep Seer-specific policy in this file and the repository docs, not in the copied Ultrakit skill definitions.
