# Post-MVP Exec Plan: AI Investigation Workbench Execution

**Status:** completed  
**Target order:** post-MVP track 12  
**Agent slot:** AI-WORKBENCH-1  
**Predecessor:** `docs/exec-plans/completed/ai-first-investigation-and-managed-agents.md`  
**Successor:** none  
**Last updated:** 2026-03-07

---

## Objective

Implement the AI Investigation Workbench as Seer's primary investigation surface, using semantic markdown primitives for trustworthy structured rendering without forcing a rigid JSON-first UX.

Required outcomes:

1. `/assistant` becomes the primary AI Investigation Workbench route rather than a generic fallback chat page.
2. The workbench accepts natural-language operational questions and performs evidence-grounded investigation before sending users into expert tooling.
3. Workbench answers render from markdown-first narrative output plus a small set of semantic block primitives:
   - `:::evidence`
   - `:::caveat`
   - `:::next-action`
   - `:::follow-up`
   - `:::linked-surface`
4. Backend orchestration reuses ontology, process-mining, RCA, and existing assistant context infrastructure, but returns a workbench-specific contract and streaming behavior.
5. Expert drill-down handoffs from workbench results are explicit and deep-linkable.
6. Clarifying-question behavior is supported without turning the product into a rigid wizard.
7. Legacy generic assistant framing on `/assistant` is intentionally removed where it conflicts with the workbench product model.

## Invariants

1. Investigation remains AI-first: users start from a business question, not manual process/RCA setup.
2. Evidence, caveats, and recommendations remain visually distinct.
3. Ontology grounding and read-only evidence gathering remain the default posture.
4. The workbench is markdown-first in presentation, but not semantics-free.
5. Semantic markdown primitives are optional and additive; plain markdown remains valid fallback content.
6. Follow-up questions preserve thread context rather than resetting investigation state.
7. Workbench recommendations are clearly separated from autonomous execution.

## Current Gap Summary

1. The current `/assistant` route uses a generic shared assistant surface and renders plain markdown bubbles only.
2. The current assistant state model persists text turns and completion history, but no workbench-specific turn metadata.
3. The current backend generic assistant endpoint streams informational ontology-copilot answers; it does not execute a dedicated workbench investigation flow.
4. A non-streaming `guided-investigation` backend path exists and already composes ontology, process mining, and RCA, but it returns a nested analytical payload rather than workbench-ready narrative output.
5. There is no semantic markdown authoring/rendering pipeline yet.
6. There is no explicit linked-surface contract for deep links into inspector/history/process/RCA surfaces.
7. Clarifying questions are open product direction today, not an implemented interaction model.

## Legacy Behavior To Remove

1. Do not keep `/assistant` positioned as a generic "Atlas Copilot" fallback route once the workbench lands.
2. Do not require users to manually choose process mining or RCA before Seer attempts an investigation.
3. Do not force every assistant response into a rigid multi-field UI schema.
4. Do not preserve plain-chat-only rendering on the dedicated workbench route if it prevents evidence/caveat/action clarity.

## Compatibility Stance

This track is explicitly not constrained by backward compatibility.

1. If current assistant routes, copy, event shapes, or storage conventions block the better workbench outcome, replace them.
2. Do not keep implementation seams solely because they match the current generic assistant architecture.
3. Reuse current code only when it accelerates the final workbench design; do not let it dictate the final behavior.
4. Breaking page-level generic assistant assumptions is acceptable if that is what the better workbench requires.

## Frozen Design Decisions

### Decision 1: Markdown-First Response Model

Use markdown as the primary response medium, with semantic block primitives for regions that need dependable UI treatment.

Rationale:

1. Plain narrative remains natural for the model and the user.
2. Trust-critical sections still get reliable rendering and extraction.
3. The UI can evolve block rendering without forcing repeated backend contract migrations.

### Decision 2: Small Semantic Primitive Set

The initial supported primitive set is intentionally small:

1. `:::evidence`
2. `:::caveat`
3. `:::next-action`
4. `:::follow-up`
5. `:::linked-surface`

No broader markdown-extension taxonomy should ship in V1.

### Decision 3: Dedicated Workbench API Path

Add a workbench-specific streaming endpoint instead of overloading the existing generic assistant endpoint.

Rationale:

1. `/api/v1/ai/assistant/chat` still serves the global shell assistant use case.
2. The workbench needs investigation-specific state, rendering semantics, and result metadata.
3. Route-level product intent stays clearer when the dedicated workbench contract is explicit.

### Decision 4: Shared Thread Foundation, Workbench-Specific Turn Metadata

Reuse the shared assistant thread/runtime foundation where it helps, but extend it with workbench-specific turn metadata instead of forcing all surfaces into identical rendering behavior.

### Decision 5: No New Network Dependencies For Rendering

Prefer a local semantic-markdown parser/normalizer implemented within the repo over pulling new parsing packages during this effort.

---

## Baseline Failure Ledger

Baseline run date: `2026-03-07`

Frontend baseline:

1. `cd seer-ui && npm run lint`
   - passed
2. `cd seer-ui && npm run test:contracts`
   - failed with a pre-existing failing contract:
   - `tests/insights.contract.test.mjs`
3. `cd seer-ui && npm run build`
   - passed

Backend baseline:

1. `seer-backend/.venv/bin/ruff check seer-backend/src seer-backend/tests`
   - failed with a pre-existing import-sort issue outside workbench scope:
   - `seer-backend/tests/test_ontology_phase1.py:1`
2. `seer-backend/.venv/bin/pytest seer-backend/tests/test_ai_phase5.py`
   - passed (`13 passed`)

Rules for worker phases:

1. Treat the frontend `insights` contract test failure as non-regression unless a phase touches that area.
2. Treat the backend Ruff import-sort failure in `test_ontology_phase1.py` as non-regression unless a phase intentionally normalizes repository-wide import order.
3. Each worker must cite this ledger when reporting validation results.

---

## Delivery Scope

In scope:

1. Dedicated workbench streaming API and backend response model.
2. Semantic markdown composition and rendering.
3. Workbench page UX, investigation state, and result presentation.
4. Clarifying-question interaction contract.
5. Expert-surface linked handoffs.
6. Docs/spec/index updates needed to keep product and execution truth current.

Out of scope for this plan:

1. Managed-agent activation or runtime implementation.
2. Final approval/authz flows.
3. Organization-level persistence of conversations beyond current local/shared thread model.
4. Rebuilding the global shell assistant into the full workbench in the same pass.
5. New external markdown/rendering dependencies that require lockfile/network churn.

---

## Sequential Phase Plan

## Phase 0: Baseline + Contract Freeze

**Status:** completed

**Goal:** lock the baseline quality signal and freeze the architectural direction before implementation.

Deliverables:

1. Baseline failure ledger captured in this plan.
2. Markdown-first semantic response model frozen.
3. Dedicated workbench API path decision frozen.
4. Shared-thread-plus-workbench-metadata direction frozen.

Exit criteria:

1. Pre-existing failures are documented clearly enough to avoid future ambiguity.
2. Workers can start implementation without reopening core product/contract questions.

## Phase 1: Backend Workbench Contract + Streaming Skeleton

**Status:** completed

**Goal:** create a dedicated workbench backend path with explicit streaming/meta/final contracts, while reusing existing investigation services.

Primary files:

1. `seer-backend/src/seer_backend/api/ai.py`
2. `seer-backend/src/seer_backend/ai/gateway.py`
3. `seer-backend/tests/test_ai_phase5.py`
4. New backend module(s) under `seer-backend/src/seer_backend/ai/` if extraction is warranted
5. `docs/exec-plans/completed/ai-investigation-workbench-execution.md`

Expected implementation:

1. Add workbench-specific request/response models and SSE event shapes.
2. Add a dedicated route such as `POST /api/v1/ai/workbench/chat`.
3. Reuse existing ontology/process/RCA orchestration as the first implementation substrate.
4. Preserve the generic assistant endpoint for non-workbench surfaces.
5. Include minimal interaction metadata needed for the frontend to distinguish:
   - investigation answer,
   - clarifying question turn,
   - investigation progress,
   - linked surface hints.
6. Do not force the final payload into a heavy nested UI schema.

Exit criteria:

1. The backend exposes a dedicated workbench streaming contract.
2. Existing `guided-investigation` logic is reusable from the workbench flow instead of being duplicated.
3. Targeted tests cover happy-path streaming and clarifying-question behavior.

Validation:

1. `seer-backend/.venv/bin/pytest seer-backend/tests/test_ai_phase5.py`
2. `seer-backend/.venv/bin/ruff check seer-backend/src/seer_backend/api/ai.py seer-backend/src/seer_backend/ai seer-backend/tests/test_ai_phase5.py`

Worker handoff requirements:

1. Read first:
   - `docs/product-specs/ai-investigation-workbench.md`
   - `seer-backend/src/seer_backend/api/ai.py`
   - `seer-backend/src/seer_backend/ai/gateway.py`
   - `seer-backend/tests/test_ai_phase5.py`
2. Keep scope limited to backend contracts/orchestration/tests.
3. Update this plan's progress log and phase status.
4. Commit subject:
   - `Add AI workbench backend streaming contract`

## Phase 2: Semantic Markdown Composer + Workbench Response Authoring

**Status:** completed

**Goal:** make backend investigation answers emit markdown with semantic primitives rather than raw nested analysis payloads.

Primary files:

1. `seer-backend/src/seer_backend/ai/gateway.py`
2. New backend helper module(s) for semantic markdown composition/parsing as needed
3. `seer-backend/tests/test_ai_phase5.py`
4. `docs/design-docs/` addition only if the implementation reveals a reusable semantic-markdown contract worth preserving
5. `docs/exec-plans/completed/ai-investigation-workbench-execution.md`

Expected implementation:

1. Compose narrative markdown from ontology/process/RCA evidence.
2. Emit semantic blocks for evidence, caveats, next actions, follow-up prompts, and linked surfaces.
3. Keep blocks optional so degraded/fallback answers still render.
4. Make recommendations visibly distinct from established findings.
5. Encode enough linked-surface metadata to build stable deep links without bloating the response contract.

Exit criteria:

1. Backend final payloads contain workbench-ready semantic markdown.
2. Tests assert presence/shape of supported semantic blocks.
3. The implementation does not require new third-party markdown dependencies.

Validation:

1. `seer-backend/.venv/bin/pytest seer-backend/tests/test_ai_phase5.py`
2. `seer-backend/.venv/bin/ruff check seer-backend/src/seer_backend/ai seer-backend/tests/test_ai_phase5.py`

Worker handoff requirements:

1. Read first:
   - Phase 1 landed backend files
   - `docs/product-specs/ai-investigation-workbench.md`
   - this plan
2. Stay out of frontend/UI rendering.
3. Update plan progress/decision logs and phase status.
4. Commit subject:
   - `Compose semantic markdown responses for AI workbench`

## Phase 3: Frontend Workbench API Adapter + Semantic Renderer Foundation

**Status:** completed

**Goal:** build the frontend data and rendering foundation for workbench-specific streaming and semantic markdown blocks.

Primary files:

1. `seer-ui/app/lib/api/assistant-chat.ts`
2. New `seer-ui/app/lib/api/workbench.ts`
3. `seer-ui/app/components/assistant/shared-assistant-state.tsx`
4. `seer-ui/app/components/assistant/use-shared-assistant-runtime.ts`
5. New workbench rendering utilities/components under `seer-ui/app/components/assistant/` or `seer-ui/app/components/workbench/`
6. `seer-ui/tests/*.test.mjs` as needed
7. `docs/exec-plans/completed/ai-investigation-workbench-execution.md`

Expected implementation:

1. Add a dedicated frontend API client for the workbench stream.
2. Extend shared thread storage with minimal workbench turn metadata.
3. Add a semantic markdown tokenizer/parser/renderer path for supported blocks.
4. Preserve plain markdown rendering as fallback for unknown or absent blocks.
5. Keep the global assistant path working unless a touched file intentionally migrates it.

Exit criteria:

1. Frontend can consume the workbench stream independently of the generic assistant path.
2. Semantic blocks render with stable, testable UI primitives.
3. Shared thread persistence still works after metadata extension.

Validation:

1. `cd seer-ui && npm run lint`
2. `cd seer-ui && npm run test:contracts`
3. UI QA against `http://localhost:3000` using the `playwright-interactive` skill or equivalent local browser validation for semantic block rendering and thread persistence.

Worker handoff requirements:

1. Read first:
   - `seer-ui/app/components/assistant/assistant-workspace.tsx`
   - `seer-ui/app/components/assistant/shared-assistant-state.tsx`
   - `seer-ui/app/lib/api/assistant-chat.ts`
   - any Phase 1/2 contract changes
   - this plan
2. Limit scope to data layer plus renderer foundation.
3. Document any intentional metadata-shape changes in the plan log.
4. Commit subject:
   - `Add workbench frontend stream and semantic renderer`
5. Frontend workers may use the `playwright-interactive` skill against `http://localhost:3000` for local validation.

## Phase 4: Dedicated `/assistant` Workbench Surface

**Goal:** replace the generic dedicated assistant page experience with the primary workbench UX.

Primary files:

1. `seer-ui/app/assistant/page.tsx`
2. `seer-ui/app/components/assistant/assistant-page-workspace.tsx`
3. `seer-ui/app/components/assistant/assistant-workspace.tsx`
4. New workbench page/surface components
5. Nearby layout/nav files if route labeling or affordances change
6. `docs/exec-plans/completed/ai-investigation-workbench-execution.md`

Expected implementation:

1. Replace generic "Atlas Copilot" framing on `/assistant` with workbench-first language and layout.
2. Add question intake, investigation progress treatment, and result rendering designed around semantic blocks.
3. Preserve deep-link seed prompt behavior from `?q=`.
4. Keep thread continuity and follow-up questioning behavior.
5. Make evidence, caveats, next actions, and linked surfaces visually distinct.
6. Do not regress keyboard input or thread-list basics.

Exit criteria:

1. `/assistant` reads as the primary AI Investigation Workbench, not a generic assistant.
2. Workbench turns render rich structured results from semantic markdown.
3. Follow-up turns remain conversational instead of wizard-driven.

Validation:

1. `cd seer-ui && npm run lint`
2. `cd seer-ui && npm run test:contracts`
3. `cd seer-ui && npm run build`
4. UI QA against `http://localhost:3000` using the `playwright-interactive` skill or equivalent local browser validation for:
   - workbench question intake,
   - progress state,
   - semantic block rendering,
   - `?q=` seed behavior,
   - follow-up turn continuity.

Worker handoff requirements:

1. Read first:
   - Phase 3 landed frontend files
   - `seer-ui/app/assistant/page.tsx`
   - `seer-ui/app/components/assistant/assistant-page-workspace.tsx`
   - `seer-ui/app/components/assistant/assistant-workspace.tsx`
   - this plan
2. Limit scope to the dedicated page/surface UX.
3. If route-level wording changes, update this plan log.
4. Commit subject:
   - `Turn /assistant into the AI investigation workbench`
5. Frontend workers may use the `playwright-interactive` skill against `http://localhost:3000` for local validation.

## Phase 5: Expert Handoffs + Clarifying-Question UX

**Goal:** complete the workbench interaction loop with drill-down links and explicit clarification behavior.

Primary files:

1. Workbench backend/streaming files from Phases 1-2
2. Workbench frontend files from Phases 3-4
3. Relevant inspector link/URL helper files under `seer-ui/app/lib/` or `seer-ui/app/components/inspector/`
4. `docs/product-specs/ai-investigation-workbench.md`
5. `docs/exec-plans/completed/ai-investigation-workbench-execution.md`

Expected implementation:

1. Convert `:::linked-surface` blocks into real deep links for:
   - ontology exploration,
   - history inspection,
   - process mining,
   - RCA,
   - action status where applicable.
2. Support clarifying turns without losing the investigation thread.
3. Ensure recommendations are clearly distinguishable from facts.
4. Ensure low-evidence or partial-data cases render caveats prominently.

Exit criteria:

1. Workbench results hand users into expert surfaces without dead ends.
2. Clarifying-question turns feel intentional and lightweight.
3. The acceptance expectations in the product spec are substantially covered by the delivered flow.

Validation:

1. `seer-backend/.venv/bin/pytest seer-backend/tests/test_ai_phase5.py`
2. `cd seer-ui && npm run test:contracts`
3. `cd seer-ui && npm run build`
4. UI QA against `http://localhost:3000` using the `playwright-interactive` skill or equivalent local browser validation for:
   - linked-surface navigation,
   - clarifying-question turns,
   - caveat prominence,
   - recommendation/fact separation.

Worker handoff requirements:

1. Read first:
   - Phase 4 landed UI
   - Phase 2 backend semantic block output
   - `docs/product-specs/ai-investigation-workbench.md`
   - this plan
2. Stay focused on handoffs and clarification flow; avoid unrelated styling churn.
3. Update spec and plan together if user-visible behavior changes.
4. Commit subject:
   - `Add workbench clarifications and expert handoffs`
5. Frontend workers may use the `playwright-interactive` skill against `http://localhost:3000` for local validation.

## Phase 6: Hardening, Docs, and Completion Transition

**Goal:** ratify the workbench against docs, validation, and execution-plan lifecycle rules.

Primary files:

1. `VISION.md` only if product framing materially changes
2. `DESIGN.md` or `docs/design-docs/*` if implementation reveals a reusable semantic-markdown design rule
3. `ARCHITECTURE.md`
4. `docs/product-specs/index.md`
5. `docs/product-specs/ai-investigation-workbench.md`
6. `docs/exec-plans/active/index.md`
7. `docs/exec-plans/completed/ai-investigation-workbench-execution.md`
8. `docs/exec-plans/completed/README.md`
9. `docs/exec-plans/tech-debt-tracker.md` if needed

Expected implementation:

1. Update canonical docs/specs/indexes to reflect delivered workbench behavior.
2. Record any intentionally deferred gaps in tech debt.
3. Run final validation across touched frontend/backend scope.
4. Move this plan to `docs/exec-plans/completed/` only after acceptance is met.

Exit criteria:

1. Docs, specs, and indexes reflect the delivered workbench.
2. Final validation passes or only documented pre-existing failures remain.
3. Plan can be archived cleanly.

Validation:

1. `cd seer-ui && npm run lint`
2. `cd seer-ui && npm run test:contracts`
3. `cd seer-ui && npm run build`
4. `seer-backend/.venv/bin/pytest seer-backend/tests/test_ai_phase5.py`
5. `seer-backend/.venv/bin/ruff check seer-backend/src/seer_backend/api/ai.py seer-backend/src/seer_backend/ai seer-backend/tests/test_ai_phase5.py`
6. Final UI QA against `http://localhost:3000` using the `playwright-interactive` skill or equivalent local browser validation.

Worker handoff requirements:

1. Read first:
   - this plan
   - touched canonical docs/specs/indexes
2. Archive the plan only after controller verification passes.
3. Commit subject:
   - `Ratify AI investigation workbench docs and validation`

---

## Acceptance Criteria

1. Users can open `/assistant` and start with a natural-language operational question.
2. The workbench performs investigation using ontology/history/analytics before demanding manual expert setup.
3. Final rendered answers distinguish evidence, caveats, next actions, follow-up prompts, and linked surfaces.
4. Semantic markdown primitives are supported and render gracefully when partially present.
5. Follow-up questions preserve investigation context.
6. Clarifying questions are possible without forcing a rigid multi-step wizard.
7. Linked drill-downs into expert surfaces are visible and actionable.
8. Recommendations remain clearly separate from established facts and from autonomous execution.
9. Validation passes or only documented pre-existing baseline failures remain.
10. Active/completed/spec indexes remain accurate throughout execution.

## Phase 6 Acceptance Evidence

1. `cd seer-ui && npm run lint` -> pass.
2. `cd seer-ui && npm run test:contracts` -> expected non-regression failure remains isolated to pre-existing `tests/insights.contract.test.mjs`.
3. `cd seer-ui && npm run build` -> pass.
4. `seer-backend/.venv/bin/pytest seer-backend/tests/test_ai_phase5.py -q` -> pass (`15 passed`).
5. `seer-backend/.venv/bin/ruff check seer-backend/src/seer_backend/api/ai.py seer-backend/src/seer_backend/ai seer-backend/tests/test_ai_phase5.py` -> pass.
6. `ARCHITECTURE.md`, `DESIGN.md`, and `docs/exec-plans/tech-debt-tracker.md` required no change because the delivered workbench behavior already matched the canonical architecture/design rules and introduced no new accepted residual debt.

## Validation Strategy

Phase-local validation:

1. Backend phases: targeted `pytest` plus scoped `ruff check`.
2. Frontend phases: `npm run lint`, `npm run test:contracts`, and `npm run build` when route/rendering changes land.

Milestone validation:

1. After Phase 2: backend tests + scoped Ruff.
2. After Phase 4: frontend lint/contracts/build.
3. After Phase 6: frontend lint/contracts/build + backend tests + scoped Ruff.

## Docs Impact

1. `docs/product-specs/ai-investigation-workbench.md`
2. `docs/product-specs/index.md`
3. `docs/exec-plans/active/index.md`
4. `docs/exec-plans/completed/ai-investigation-workbench-execution.md`
5. `ARCHITECTURE.md` if surface/runtime boundaries materially change
6. `DESIGN.md` or `docs/design-docs/*` only if reusable semantic-markdown rules need canonical capture
7. `docs/exec-plans/tech-debt-tracker.md` if deferrals remain after ratification

## Worker Execution Rules

1. Exactly one implementation phase worker is active at a time.
2. Every worker must use the `execute-phase` skill.
3. Every worker handoff must include:
   - work-so-far summary,
   - exact files to read first,
   - phase-only scope,
   - required validations,
   - required plan/doc updates,
   - commit subject.
4. Controller verifies each worker locally before advancing the plan.
5. If a worker misses plan/doc updates, validation, or commit requirements, the phase stays open and a gap-closer worker is spawned.

## Decision Log

1. 2026-03-07: Chosen delivery model is markdown-first with semantic block primitives instead of a rigid all-turn UI schema.
2. 2026-03-07: The initial semantic primitive set is intentionally limited to five blocks to avoid schema sprawl.
3. 2026-03-07: The workbench will ship behind a dedicated backend endpoint rather than overloading the generic assistant endpoint.
4. 2026-03-07: The shared assistant thread foundation will be extended with workbench-specific metadata instead of discarded wholesale.
5. 2026-03-07: No new network-fetched markdown/rendering dependencies are required for V1.
6. 2026-03-07: Backward compatibility is explicitly not a delivery constraint for this plan.
7. 2026-03-07: Frontend phases may use Playwright-driven QA against `http://localhost:3000`.
8. 2026-03-07: Phase 1 workbench streaming reuses the existing SSE framing (`meta`, `assistant_delta`, `final`, `done`) and adds workbench-specific `investigation_status` plus `linked_surface_hint` events instead of inventing a separate transport model.
9. 2026-03-07: Backend semantic markdown stays narrative-first; typed linked-surface metadata remains in the response contract alongside rendered `:::linked-surface` blocks.
10. 2026-03-07: Phase 3 routes the dedicated `/assistant` page through workbench stream mode while intentionally deferring the full copy/layout rewrite to Phase 4.
11. 2026-03-07: Phase 4 keeps the shared assistant surface component but allows the dedicated `/assistant` page variant to diverge aggressively in copy, layout, and investigation-status treatment.
12. 2026-03-07: Phase 5 deep links should prefer real scoped expert surfaces; where Seer cannot safely infer a specific live action-status target, the handoff should land on ontology action capabilities and explicitly say that live status still requires manual verification.
13. 2026-03-07: Phase 6 ratification confirmed no additional `ARCHITECTURE.md`, `DESIGN.md`, or tech-debt updates were needed because the delivered workbench behavior stayed within already-ratified product/design/architecture boundaries.

## Completion Summary

1. Delivered the AI Investigation Workbench as Seer's `/assistant` experience with dedicated streaming, semantic markdown rendering, clarifying turns, and expert-surface handoffs.
2. Ratified the shipped behavior in canonical product docs by promoting `docs/product-specs/ai-investigation-workbench.md` from draft to completed state and aligning the spec with the markdown-first response contract.
3. Closed the execution-plan lifecycle by updating active/completed indexes, recording final Phase 6 validation evidence, and archiving this plan under `docs/exec-plans/completed/`.

## Known Issues and Deferrals

1. No new workbench-specific debt entries were added. Remaining validation noise is unchanged from the baseline ledger: the pre-existing frontend contract failure in `seer-ui/tests/insights.contract.test.mjs` remains outside this phase's scope.

## Progress Log

1. 2026-03-07: Opened the active execution plan for AI Investigation Workbench implementation.
2. 2026-03-07: Captured current-state gaps across `/assistant`, shared assistant runtime, generic assistant streaming, and `guided-investigation`.
3. 2026-03-07: Recorded baseline validation ledger before feature implementation:
   - `seer-ui`: lint passed, contracts failed in `tests/insights.contract.test.mjs`, build passed
   - `seer-backend`: workbench-targeted AI tests passed, scoped Ruff surfaced pre-existing import-sort issue in `tests/test_ontology_phase1.py`
4. 2026-03-07: Froze the workbench delivery direction around semantic markdown primitives, dedicated workbench API, and shared-thread-plus-workbench-metadata architecture.
5. 2026-03-07: Reconfirmed with the user that backward compatibility is not required and that local UI QA may target `http://localhost:3000`.
6. 2026-03-07: Completed Phase 1 backend delivery:
   - added dedicated `POST /api/v1/ai/workbench/chat` SSE route
   - added workbench request/response contracts, clarifying-question turn support, and linked-surface hints
   - reused `guided_investigation()` as the first workbench investigation substrate
   - added streaming contract tests for investigation-answer and clarifying-question flows
   - validation passed: `seer-backend/.venv/bin/pytest seer-backend/tests/test_ai_phase5.py -q` (`15 passed`) and `seer-backend/.venv/bin/ruff check seer-backend/src/seer_backend/api/ai.py seer-backend/src/seer_backend/ai seer-backend/tests/test_ai_phase5.py`
7. 2026-03-07: Completed Phase 2 backend semantic-markdown authoring:
   - workbench investigation answers now compose `:::evidence`, `:::caveat`, `:::next-action`, `:::follow-up`, and `:::linked-surface` blocks
   - clarifying turns now emit semantic `:::follow-up` and `:::caveat` blocks
   - linked-surface metadata remains typed in the response while rendered blocks mirror the same drill-down targets
   - validation passed: `seer-backend/.venv/bin/pytest seer-backend/tests/test_ai_phase5.py -q` (`15 passed`) and `seer-backend/.venv/bin/ruff check seer-backend/src/seer_backend/ai seer-backend/tests/test_ai_phase5.py`
8. 2026-03-07: Completed Phase 3 frontend stream and semantic renderer foundation:
   - added shared SSE helpers plus a dedicated frontend workbench stream client
   - extended shared assistant state with workbench thread experience, investigation IDs, and per-message workbench metadata
   - added a local semantic markdown parser for `:::evidence`, `:::caveat`, `:::next-action`, `:::follow-up`, and `:::linked-surface`
   - rendered semantic blocks inside assistant messages with plain markdown fallback and workbench-specific linked-surface affordances
   - routed the dedicated `/assistant` page workspace into workbench stream mode without doing the full page UX rewrite yet
   - added frontend contract coverage for the workbench client, semantic parser, and page-mode wiring
   - validation passed: `cd seer-ui && npm run lint`, `cd seer-ui && npm run build`, and `cd seer-ui && npm run test:contracts` with only the pre-existing `tests/insights.contract.test.mjs` failure remaining
9. 2026-03-07: Completed Phase 4 dedicated `/assistant` workbench surface:
   - replaced generic assistant framing on the dedicated page with AI-workbench-first copy, empty-state guidance, and page-specific layout treatment
   - added page-visible investigation status treatment driven by streamed `investigation_status` events
   - widened workbench answer cards so semantic markdown sections read like investigation artifacts rather than chat bubbles
   - preserved `?q=` seed behavior and validated the live clarifying-turn flow against `http://127.0.0.1:3000/assistant?q=Investigate%20order%20delay%20risk`
   - validation passed: `cd seer-ui && npm run lint`, `cd seer-ui && npm run build`, and `cd seer-ui && npm run test:contracts` with only the pre-existing `tests/insights.contract.test.mjs` failure remaining
10. 2026-03-07: Completed Phase 5 expert handoffs + clarifying-question UX:
   - replaced placeholder workbench `:::linked-surface` targets with scoped ontology, history, process-mining, RCA, and ontology-actions deep links
   - used sampled RCA anchor keys for precise history links when available and explicit non-dead-end history/action fallback copy when not
   - persisted workbench scope in thread state so clarification choices carry into reruns and later follow-up turns
   - added a lightweight clarification strip on `/assistant` for anchor-object selection, recent time-window presets, and scoped reruns
   - strengthened recommendation/caveat treatment so suggestions read distinctly from findings and caveats stay prominent before acting
   - validation passed: `seer-backend/.venv/bin/pytest seer-backend/tests/test_ai_phase5.py -q`, `cd seer-ui && npm run build`, `cd seer-ui && npm run test:contracts` with only the pre-existing `tests/insights.contract.test.mjs` failure remaining, plus browser QA against `http://127.0.0.1:3000/assistant?q=Investigate%20order%20delay%20risk` using a mocked scoped rerun because the local backend returned an invalid OpenAI API key on real scoped investigation requests
11. 2026-03-07: Completed Phase 6 ratification and archive transition:
   - promoted `docs/product-specs/ai-investigation-workbench.md` from draft to completed and aligned the spec with the delivered markdown-first semantic-block contract
   - updated `docs/product-specs/index.md`, `docs/exec-plans/active/index.md`, and `docs/exec-plans/completed/README.md` so active/completed coverage reflects the shipped workbench
   - reran final frontend/backend validation; only the pre-existing `seer-ui/tests/insights.contract.test.mjs` contract failure remained
   - archived this plan to `docs/exec-plans/completed/ai-investigation-workbench-execution.md` with Phase 6 marked complete

## Progress Tracking

- [x] Phase 0 complete
- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete
- [x] Phase 4 complete
- [x] Phase 5 complete
- [x] Phase 6 complete

Current execution state:

1. All six phases are complete.
2. Final validation matched the baseline ledger except for the pre-existing frontend `tests/insights.contract.test.mjs` failure.
3. This plan is archived under `docs/exec-plans/completed/`.

## Controller Handoff Packet: Phase 1

Work-so-far summary:

1. Current base commit before workbench implementation: `fa45315` (`Switch OpenAI runtime defaults to opencode big-pickle`)
2. Controller-opened planning/docs changes are present in:
   - `docs/exec-plans/completed/ai-investigation-workbench-execution.md`
   - `docs/exec-plans/active/index.md`
   - `docs/product-specs/index.md`
   - `docs/product-specs/ai-investigation-workbench.md`
3. Dirty unrelated working-tree files already exist and are not part of Phase 1:
   - `README.md`
   - `docker-compose.yml`
   - `seer-backend/src/seer_backend/ai/ontology_copilot.py`
   - `seer-backend/src/seer_backend/config/settings.py`
   - `seer-backend/tests/test_ontology_phase1.py`
   - `.devcontainer-seeded`
4. Baseline ledger to preserve:
   - `seer-ui` lint passed
   - `seer-ui` contract suite has a pre-existing failure in `tests/insights.contract.test.mjs`
   - `seer-ui` build passed
   - backend AI test slice passed
   - backend scoped Ruff exposed a pre-existing import-sort issue in `seer-backend/tests/test_ontology_phase1.py`

Initial lookup (required):

1. `docs/product-specs/ai-investigation-workbench.md`
2. `docs/exec-plans/completed/ai-investigation-workbench-execution.md`
3. `seer-backend/src/seer_backend/api/ai.py`
4. `seer-backend/src/seer_backend/ai/gateway.py`
5. `seer-backend/tests/test_ai_phase5.py`

Phase 1 goals:

1. Add a dedicated backend streaming contract for AI Investigation Workbench.
2. Reuse existing investigation services instead of duplicating orchestration logic.
3. Keep the generic assistant endpoint intact for non-workbench surfaces.
4. Add targeted tests for the new workbench contract and clarifying-turn shape.

Scope constraints:

1. Backend only. Do not change `seer-ui` in this phase.
2. Do not revert unrelated working-tree changes.
3. Do not preserve legacy `/assistant` generic-page behavior in backend naming/contracts if it conflicts with the dedicated workbench direction.
4. Do not introduce new third-party dependencies.
5. Keep the response model lightweight enough to support markdown-first rendering in Phase 2.

Validation required:

1. `seer-backend/.venv/bin/pytest seer-backend/tests/test_ai_phase5.py`
2. `seer-backend/.venv/bin/ruff check seer-backend/src/seer_backend/api/ai.py seer-backend/src/seer_backend/ai seer-backend/tests/test_ai_phase5.py`

Plan/doc update required:

1. Update this plan's progress log with dated Phase 1 completion notes.
2. Mark the Phase 1 checklist item complete if the phase lands fully.
3. Add any contract-level decision changes to the decision log if implementation reveals necessary refinements.

Git requirements:

1. Stage only phase-relevant files.
2. Commit subject: `Add AI workbench backend streaming contract`
3. Commit body must cover:
   - what backend contracts/orchestration changed,
   - why a dedicated workbench endpoint was introduced,
   - impact on AI API/tests/docs.
