# Post-MVP Exec Plan: Assistant Conversation, Canvas, And Skill Loading

**Status:** in_progress  
**Target order:** post-MVP track 13  
**Agent slot:** AI-ASSISTANT-1  
**Predecessor:** `docs/exec-plans/completed/ai-investigation-workbench-execution.md`  
**Successor:** `Phase 1: Canonical Assistant Contract Unification`  
**Last updated:** 2026-03-07

---

## Objective

Redesign `/assistant` into Seer’s primary AI-first conversational surface:

1. one canonical assistant conversation contract based on chat-completions-style `completion_messages`,
2. one central assistant backend that starts with lightweight ontology context and ontology tools,
3. dynamic skill loading that expands the assistant’s instructions and tool access when the task calls for it,
4. a Gemini-canvas-style split layout where the assistant can fluidly open a right-side canvas,
5. tool-produced artifacts that the assistant can present in the canvas using existing Seer visualization components such as OC-DFG.

This replaces the narrower “workbench as a static investigation workflow” direction.

## Why This Plan Exists

The current `/assistant` experience is wrong in three ways:

1. It diverged from the chat-completions-style conversational assistant model and became a fixed investigation workflow.
2. It introduced a heavy page-specific UI treatment that feels more like a staged dashboard than a conversation-first assistant.
3. It treats visual drill-down as handoff/navigation rather than letting the assistant open and control a canvas beside the conversation.

The user clarified the preferred model:

1. `/assistant` should remain the canonical assistant surface.
2. The assistant should begin generic, grounded in ontology context.
3. The assistant should be able to load skills dynamically based on user intent.
4. The assistant should be able to open a canvas and show artifacts such as OC-DFG without leaving the conversation.

## Product Model To Implement

The intended `/assistant` product model is:

1. User talks to a single general Seer assistant.
2. The assistant starts with:
   - the normal conversational assistant contract,
   - lightweight ontology context,
   - ontology tools only.
3. When the task demands deeper capability, the assistant calls `load_skill`.
4. Loading a skill:
   - injects skill instructions,
   - enables the tools associated with that skill,
   - preserves the same conversation thread and endpoint.
5. Domain tools return typed artifacts.
6. The assistant can call a canvas-presentation tool to open or update a right-side canvas with those artifacts.
7. The conversation remains primary even when the canvas is open.

## Desired UX

The target `/assistant` interaction should feel like:

1. full-width conversation by default,
2. calm, generic assistant framing rather than a page-specific workflow dashboard,
3. assistant decides when to stay purely conversational and when to present a canvas,
4. when canvas is presented, the thread smoothly shrinks left and the canvas opens on the right,
5. conversation continues while the artifact remains live,
6. assistant can replace, update, or close the canvas without forcing route changes.

Gemini local split-canvas reference:

1. conversation remains visible and primary,
2. artifact occupies the right canvas,
3. canvas feels attached to the conversation rather than like a separate module.

## Current Gap Summary

### Contract And Orchestration Gaps

1. The current workbench request contract carries only a single `question` plus lightweight scope instead of full `completion_messages`.
2. The current workbench backend path is a fixed clarify-or-investigate branch rather than a conversational tool-using loop.
3. The real `/assistant` route uses the workbench experience instead of behaving like the generic assistant with stronger capabilities.
4. Assistant-turn logging is wired to the legacy assistant path but not to the real `/assistant` workbench path.

### Skill Loading Gaps

1. There is no first-class runtime concept of `load_skill` in the Seer assistant backend today.
2. Existing specialized intelligence for ontology, process mining, RCA, and history is encoded as endpoints/modules, not as dynamically activatable assistant skills.
3. Tool access is effectively pre-baked by endpoint choice instead of being expanded conditionally inside the same conversation.

### Canvas And Artifact Gaps

1. The assistant cannot currently open a persistent right-side canvas in `/assistant`.
2. Visualizations such as OC-DFG only exist inside their dedicated expert surfaces today.
3. There is no assistant artifact contract that lets tools return a reusable visualization payload or handle.
4. There is no canvas tool that lets the assistant choose what should be shown beside the conversation.

### UI Regression Gaps

Baseline comparison commit: `fa45315`

Compared with the calmer pre-workbench `/assistant` page, the current implementation introduced:

1. workbench-specific page framing and explanatory chrome,
2. gradient page header and gradient viewport/background treatment,
3. a heavier raised outer page card,
4. widened workbench message cards and extra semantic callout cards,
5. a large inline clarification panel that reads as workflow UI,
6. a page identity that no longer feels like the generic assistant.

## Legacy Behavior To Remove

1. Do not keep `/assistant` hard-bound to the dedicated workbench contract.
2. Do not keep the fixed clarification gate as the default first-turn behavior.
3. Do not keep separate assistant vs workbench conversation protocols when one specialized assistant protocol will do.
4. Do not keep visual drill-down limited to page navigations and deep links if the assistant can present artifacts inline in canvas.
5. Do not keep the heavy page-specific dashboard styling on `/assistant`.

## Compatibility Stance

This track is not constrained by backward compatibility.

1. If the workbench endpoint is the wrong abstraction, replace or absorb it.
2. If current state/storage conventions are too specialized around workbench-only fields, simplify them.
3. If the assistant page layout needs to revert or reorganize to support canvas, do it.
4. Reuse existing graph/tooling code where it helps, but do not preserve the current workbench architecture out of inertia.

## Frozen Design Decisions

### Decision 1: One Canonical Conversation Contract

The primary `/assistant` surface should use the same chat-completions-style `completion_messages` contract as the generic assistant experience. Specialized behavior comes from prompt, tools, skill loading, and runtime policy, not from a second interaction contract.

### Decision 2: Skills Expand The Assistant At Runtime

The assistant starts with ontology-grounded generic capabilities and calls `load_skill` to activate deeper capabilities such as process mining, RCA, object history, object store exploration, or deeper ontology analysis.

### Decision 3: Canvas Is Tool-Driven, Not Markdown-Driven

Markdown remains for what the assistant says. Canvas state is an application side effect chosen through tool calls. The assistant should not author arbitrary canvas UI state in prose.

### Decision 4: Artifacts Are The Bridge Between Tools And Canvas

Domain tools should return typed artifacts or artifact handles. A dedicated canvas tool presents those artifacts in the UI. This keeps rendering deterministic without creating a second user-visible assistant protocol.

### Decision 5: `/assistant` Starts Generic And Opens Visuals When Helpful

The assistant should not default to a canvas-first or workflow-first interaction. Canvas opens only when a visualization materially helps the user understand or inspect the result.

### Decision 6: Logging Follows The Real Product Path

Assistant turn logging must follow the actual `/assistant` runtime, including skill activation, domain tool execution, artifact creation, and canvas presentation.

---

## Baseline Validation And Regression Ledger

Recorded on: `2026-03-07`

Controller baseline validation for this execution track:

1. `cd seer-ui && npm run lint`
   - passed
2. `cd seer-ui && npm run build`
   - passed
3. `cd seer-ui && npm run test:contracts`
   - failed only in pre-existing `tests/insights.contract.test.mjs`
4. `seer-backend/.venv/bin/pytest seer-backend/tests/test_ai_phase5.py -q`
   - passed (`15 passed`)
5. `seer-backend/.venv/bin/ruff check seer-backend/src/seer_backend/api/ai.py seer-backend/src/seer_backend/ai seer-backend/tests/test_ai_phase5.py`
   - passed

Known issues this plan will address:

1. `/assistant` is currently implemented as workbench mode rather than the canonical generic assistant surface.
2. Workbench requests do not carry conversational history.
3. Assistant logging misses the real `/assistant` path.
4. The current `/assistant` page styling regressed from the calmer baseline in `fa45315`.
5. There is no assistant canvas runtime or artifact presentation contract.

Existing unrelated baseline failures:

1. `cd seer-ui && npm run test:contracts`
   - pre-existing failure in `tests/insights.contract.test.mjs`
2. repository-wide backend Ruff
   - pre-existing import-sort issue outside this track in `seer-backend/tests/test_ontology_phase1.py`

## Delivery Scope

In scope:

1. Assistant endpoint/runtime contract unification around `completion_messages`.
2. Runtime skill loading model and registry/discovery support inside Seer assistant.
3. Skill-to-tool activation model.
4. Artifact contracts for OC-DFG and future visual/result types.
5. `/assistant` split-layout canvas UX and state model.
6. Assistant logging for the real `/assistant` product path.
7. Conversion of process mining, RCA, deeper ontology, object store, and object history capabilities into assistant-loadable skills or skill-backed tool bundles.
8. Docs/spec/index updates needed to keep repo truth current.

Out of scope:

1. Managed-agent runtime implementation.
2. A full arbitrary document/code canvas system; this canvas is for assistant-chosen Seer artifacts.
3. Production-grade remote skill marketplace/registry beyond what Seer needs locally/repo-wide.
4. Rebuilding every expert route immediately; expert surfaces can continue to exist while the assistant gains inline artifact presentation.

## Architecture Direction

### 1. Central Assistant Runtime

Backend:

1. one canonical assistant conversation endpoint for `/assistant`,
2. full `completion_messages` history on every turn,
3. base prompt/profile for Seer assistant,
4. ontology tools available by default,
5. runtime policy layer that can activate skills and associated tools.

Frontend:

1. one canonical assistant page runtime,
2. thread state centered on completion history,
3. canvas state attached to the thread/session but driven by tool calls and artifact messages.

### 2. Skill Activation Model

The assistant gains a tool:

1. `load_skill(name: string)`

Expected behavior:

1. discover allowed skills from configured Seer skill directories,
2. load the skill instructions progressively,
3. enable the tools associated with that skill for the current conversation,
4. log the activation event in the same assistant turn lifecycle.

Initial skill families:

1. deeper ontology analysis,
2. process mining / OC-DFG,
3. root-cause analysis,
4. object history,
5. object store.

### 3. Artifact Model

Tools that produce rich inspectable results should return artifacts.

Initial artifact families:

1. `ocdfg`
2. `rca`
3. `object-timeline`
4. `ontology-concept`
5. `table`

Artifact requirements:

1. typed artifact identity,
2. enough data or a stable handle to render with existing components,
3. concise assistant-facing summary,
4. compatibility with persisted tool-result messages.

### 4. Canvas Presentation Model

The assistant gains canvas tools such as:

1. `present_canvas_artifact`
2. `update_canvas_artifact`
3. `close_canvas`

The UI should derive visible canvas state from:

1. canvas tool call/result messages,
2. referenced artifact payloads or handles,
3. the latest chosen canvas presentation in the active thread.

This keeps `completion_messages` as the canonical durable state.

## Sequential Phase Plan

## Phase 0: Vision Lock And Recovery Supersession

**Status:** completed

**Goal:** replace the narrow workbench recovery framing with the broader canonical `/assistant` direction.

Deliverables:

1. This execution plan opened and indexed.
2. Previous conversational-recovery plan superseded by this broader architecture plan.
3. Product/spec references updated to point at the new active track.
4. Local Gemini split-canvas reference captured in plan rationale.

Exit criteria:

1. Repo docs describe the new target unambiguously: `/assistant` is the canonical conversational assistant with optional canvas and skill loading.
2. The controller baseline ledger is recorded directly in this plan and accepted as the Phase 0 starting point.

Validation:

1. link/path sanity for touched docs

## Phase 1: Canonical Assistant Contract Unification

**Status:** completed

**Goal:** make `/assistant` run on the canonical assistant chat-completions-style contract again.

Primary files:

1. `seer-backend/src/seer_backend/ai/gateway.py`
2. `seer-backend/src/seer_backend/api/ai.py`
3. `seer-backend/tests/test_ai_phase5.py`
4. `seer-ui/app/lib/api/assistant-chat.ts`
5. `seer-ui/app/components/assistant/shared-assistant-state.tsx`
6. `seer-ui/app/components/assistant/assistant-page-workspace.tsx`

Expected implementation:

1. Move `/assistant` back onto the canonical assistant conversation contract using `completion_messages`.
2. Remove the dedicated workbench request shape from the primary page path.
3. Preserve the ability to specialize behavior via prompt/runtime profile without changing the wire contract.
4. Restore assistant-turn logging to the real `/assistant` path.

Exit criteria:

1. The primary `/assistant` route sends `completion_messages` history.
2. The backend receives conversational history on every `/assistant` turn.
3. Assistant logs reflect actual `/assistant` turns again.

Validation:

1. `seer-backend/.venv/bin/pytest seer-backend/tests/test_ai_phase5.py -q`
2. `seer-backend/.venv/bin/ruff check seer-backend/src/seer_backend/api/ai.py seer-backend/src/seer_backend/ai seer-backend/tests/test_ai_phase5.py`
3. `cd seer-ui && npm run test:contracts`

## Phase 2: Skill Registry And `load_skill` Runtime

**Status:** completed

**Goal:** add first-class skill discovery and runtime activation to the assistant backend.

Primary files:

1. new backend skill-loading modules under `seer-backend/src/seer_backend/ai/`
2. `seer-backend/src/seer_backend/ai/gateway.py`
3. backend settings/config files if path configuration is needed
4. backend tests for skill discovery and activation
5. relevant docs for skill directory conventions if required

Expected implementation:

1. Discover skills from configured skill directories.
2. Parse skill metadata and support progressive disclosure semantics.
3. Add `load_skill` as an assistant tool.
4. On activation, load skill instructions and enable the associated tools for the conversation.
5. Keep skill activation visible in assistant logs and tool history.

Exit criteria:

1. Assistant can start generic and load skills dynamically based on task need.
2. Activated skills expand tools/instructions without changing conversation protocol.

Validation:

1. backend targeted tests for skill discovery, parsing, activation, and collisions
2. assistant turn tests covering successful `load_skill`

## Phase 3: Domain Skill Conversion

**Status:** in_progress

**Goal:** convert Seer’s specialized analysis capabilities into assistant-loadable skill-backed tool bundles.

Primary files:

1. skill directories under project skill paths
2. process mining / RCA / ontology / history backend tool adapters
3. docs/specs for supported assistant skills where needed

Expected implementation:

1. Create or formalize skills for:
   - process mining / OC-DFG,
   - root cause,
   - deeper ontology analysis,
   - object history,
   - object store.
2. Map each skill to the tools it enables.
3. Ensure the assistant can load them only when task-relevant.

Exit criteria:

1. The assistant can start generic and expand into deeper task-specific capability through skills instead of endpoint switching.

Validation:

1. targeted backend tests per skill family
2. conversation tests proving skill activation precedes corresponding tool calls

## Phase 4: Artifact Contract And Canvas Tooling

**Status:** pending

**Goal:** introduce the artifact layer and the canvas presentation tools.

Primary files:

1. backend assistant tool/result modules
2. frontend assistant runtime/tool rendering files
3. new artifact typing/helpers under `seer-ui/app/lib/` and backend equivalents

Expected implementation:

1. Define typed artifact results for visualizable outputs.
2. Add canvas tools:
   - `present_canvas_artifact`
   - `update_canvas_artifact`
   - `close_canvas`
3. Ensure canvas tool calls and results are persisted in `completion_messages`.
4. Keep markdown for conversational explanation while using tools for canvas side effects.

Exit criteria:

1. The assistant can choose canvas content through tools.
2. Canvas state is derivable from persisted conversation/tool history.

Validation:

1. contract tests for artifact/result messages
2. UI tests for canvas open/update/close state derivation

## Phase 5: `/assistant` Split-Canvas UI Shell

**Status:** pending

**Goal:** rebuild the dedicated page as a calm conversational assistant with optional right-side canvas.

Primary files:

1. `seer-ui/app/assistant/page.tsx`
2. `seer-ui/app/components/assistant/assistant-page-workspace.tsx`
3. `seer-ui/app/components/assistant/assistant-workspace.tsx`
4. new assistant canvas components under `seer-ui/app/components/assistant/` or `seer-ui/app/components/canvas/`

Expected implementation:

1. Restore calmer generic assistant framing.
2. Default to full-width conversation.
3. Add split layout animation that opens a right-side canvas when the assistant presents an artifact.
4. Preserve uninterrupted conversation while canvas is visible.
5. Allow collapse/close/update without leaving the thread.

Exit criteria:

1. `/assistant` feels like a generic assistant that can become visual, not a workflow dashboard.
2. The page no longer has the raised/gradient regressions introduced by the workbench pass.

Validation:

1. `cd seer-ui && npm run lint`
2. `cd seer-ui && npm run test:contracts`
3. `cd seer-ui && npm run build`
4. browser QA against `http://localhost:3000/assistant`

## Phase 6: OC-DFG Canvas Integration

**Status:** pending

**Goal:** wire the first concrete canvas experience using the existing OC-DFG graphing components.

Primary files:

1. `seer-ui/app/components/inspector/ocdfg-graph.tsx`
2. `seer-ui/app/components/inspector/process-mining-panel.tsx` or extracted shared OC-DFG render helpers
3. frontend process-mining API adapters
4. backend OC-DFG assistant tool wrappers

Expected implementation:

1. Reuse the existing OC-DFG graph components inside the assistant canvas.
2. Add assistant-accessible tool flows to produce OC-DFG artifacts.
3. Support assistant behavior like:
   - explain process issue in conversation,
   - load process-mining skill,
   - run OC-DFG tool,
   - open graph in canvas,
   - continue discussing what the graph shows.

Exit criteria:

1. OC-DFG is live in the assistant canvas using existing Seer graphing infrastructure.

Validation:

1. targeted OC-DFG backend tests
2. UI QA for canvas graph rendering and conversation continuity

## Phase 7: Ratification, Docs, And Archive

**Status:** pending

**Goal:** ratify the new `/assistant` model in docs and archive the execution plan when complete.

Primary files:

1. `VISION.md` if required by final product framing changes
2. `DESIGN.md` or `docs/design-docs/*` if skill/canvas/artifact model becomes canonical
3. `ARCHITECTURE.md`
4. `docs/product-specs/ai-investigation-workbench.md`
5. `docs/product-specs/index.md`
6. `docs/exec-plans/active/index.md`
7. `docs/exec-plans/completed/README.md`
8. `docs/exec-plans/tech-debt-tracker.md` if anything intentional is deferred

Exit criteria:

1. Docs describe `/assistant` as the canonical conversational assistant with dynamic skills and optional canvas artifacts.
2. Validation passes or only documented pre-existing failures remain.
3. The plan is archived cleanly.

Validation:

1. `cd seer-ui && npm run lint`
2. `cd seer-ui && npm run test:contracts`
3. `cd seer-ui && npm run build`
4. `seer-backend/.venv/bin/pytest seer-backend/tests/test_ai_phase5.py -q`
5. targeted backend tests for OC-DFG and skill activation
6. final browser QA against `http://localhost:3000/assistant`

## Acceptance Criteria

1. `/assistant` uses a single conversational assistant contract based on `completion_messages`.
2. The assistant starts with generic ontology-grounded behavior and ontology tools only.
3. The assistant can load skills dynamically to expand instructions and tools.
4. The assistant can present artifacts in a right-side canvas without leaving the conversation.
5. Canvas state is driven by tool calls/results, not by a second user-visible assistant protocol.
6. The first implemented canvas artifact type is OC-DFG using existing Seer graphing components.
7. `/assistant` regains a calmer generic assistant visual identity while gaining the new split-canvas capability.
8. Assistant logging covers the real `/assistant` path including skill loads, artifact generation, and canvas presentation.

## Docs Impact

1. `docs/product-specs/ai-investigation-workbench.md`
2. `docs/product-specs/index.md`
3. `docs/exec-plans/active/index.md`
4. `docs/exec-plans/active/assistant-conversation-canvas-and-skills.md`
5. `ARCHITECTURE.md`
6. `DESIGN.md` or `docs/design-docs/*` if the skill/canvas/artifact model becomes canonical across Seer

## Decision Log

1. 2026-03-07: `/assistant` should return to the generic assistant contract instead of continuing on a dedicated workbench request protocol.
2. 2026-03-07: Dynamic skill loading is the preferred way to expand assistant capability for process mining, RCA, history, object store, and deeper ontology analysis.
3. 2026-03-07: Canvas presentation should be tool-driven and artifact-backed rather than markdown-driven.
4. 2026-03-07: Existing Seer OC-DFG components should be reused for the first canvas artifact implementation rather than building a new graph renderer.
5. 2026-03-07: The Gemini local split-canvas pattern is the visual interaction reference: conversation left, artifact canvas right, smooth expansion rather than route changes.
6. 2026-03-07: `docs/product-specs/ai-investigation-workbench.md` remains the delivered workbench snapshot, but it is no longer the forward `/assistant` product target; this active plan now owns the superseding execution direction until a new ratified spec is written.
7. 2026-03-07: Phase 1 keeps the dedicated workbench transport as a temporary secondary path, but `/assistant` itself now routes through the canonical assistant chat contract so skill loading and canvas phases can extend one conversation runtime instead of two.
8. 2026-03-07: Skill activation should persist through ordinary assistant/tool messages in `completion_messages`; Phase 2 therefore avoids a parallel active-skill store and reconstructs enabled tool permissions from saved conversation history.
9. 2026-03-07: Product assistant skills should load from the dedicated repo catalog at `assistant-skills/` rather than the developer `.agent/skills` or `.agents/skills` roots so the runtime skill corpus stays product-owned and reviewable.

## Progress Log

1. 2026-03-07: Opened this plan after confirming that the previous workbench implementation over-specialized the interaction contract and removed the generic assistant feel from `/assistant`.
2. 2026-03-07: Captured the revised architecture direction: one assistant contract, dynamic skills, tool-driven canvas, artifact-backed visualization, and OC-DFG as the first canvas artifact.
3. 2026-03-07: Superseded the narrower conversational-recovery framing with this broader `/assistant` redesign plan.
4. 2026-03-07: Recorded the controller baseline ledger in this plan without rerunning the full suite: `seer-ui` lint passed, `seer-ui` build passed, `seer-ui` contract tests failed only in pre-existing `tests/insights.contract.test.mjs`, `test_ai_phase5.py` passed (`15 passed`), and targeted backend Ruff checks passed.
5. 2026-03-07: Phase 0 completed by locking the redesign direction in the active plan, aligning the spec/index pointers to treat the workbench as delivered-but-superseded behavior, and setting Phase 1 contract unification as the next controller action.
6. 2026-03-07: Completed Phase 1 by rerouting `/assistant` back to the canonical assistant stream, restoring assistant-turn logging on the real product page path, and updating UI contract tests to treat the workbench transport as secondary.
7. 2026-03-07: Completed Phase 2 by adding backend skill discovery (`.agent/skills` / `.agents/skills`), parsing `allowed-tools` metadata, introducing `load_skill` into the assistant tool loop, persisting loaded skill instructions in tool messages, and deriving assistant tool permissions from conversation history. Validation passed for `test_ontology_phase1.py`, `test_ai_phase5.py`, and targeted backend Ruff checks.
8. 2026-03-07: Started Phase 3A by moving default product assistant skill discovery to the dedicated repo catalog at `assistant-skills/`, seeding `process-mining`, `root-cause`, `deep-ontology`, `object-history`, and `object-store` SKILL specs, and adding assertions that the default assistant catalog no longer matches the developer `.agents/skills` corpus.

## Progress Tracking

- [x] Phase 0 complete
- [x] Phase 1 complete
- [x] Phase 2 complete
- [ ] Phase 3 complete
- [ ] Phase 4 complete
- [ ] Phase 5 complete
- [ ] Phase 6 complete
- [ ] Phase 7 complete

Current execution state:

1. Phase 0 completed on `2026-03-07`.
2. Controller baseline validation is recorded above and accepted as the track starting ledger.
3. Phase 1 completed on `2026-03-07`.
4. Phase 2 completed on `2026-03-07`.
5. Phase 3 is in progress; Phase 3A landed the dedicated assistant skill catalog and path correction on `2026-03-07`.
6. Next action: execute the remaining Phase 3 domain tool-conversion work without marking the phase complete until tool adapters and activation flows are validated.
