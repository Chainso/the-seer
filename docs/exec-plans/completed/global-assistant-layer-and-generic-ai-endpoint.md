# Post-MVP Exec Plan: Global Assistant Layer + Generic AI Assistant Endpoint

**Status:** completed  
**Target order:** post-MVP track 3 (completed out-of-order)  
**Agent slot:** AI-UX-G1  
**Predecessor:** `docs/exec-plans/completed/post-mvp-ontology-process-readonly-adaptation.md`  
**Successor:** TBD  
**Last updated:** 2026-02-28

---

## Objective

Deliver a route-independent assistant experience and backend contract that works across Seer modules:

1. Assistant launcher button fixed in bottom-right on all app routes.
2. Slide-over assistant panel mounted at shell level (outside route content).
3. Chat state and thread management powered by `assistant-ui`.
4. Canonical backend endpoint for generic assistant chat across contexts.
5. Read-only ontology SPARQL tool available to the assistant with strict guardrails.

## Why Now

Current state has two gaps:

1. Assistant UX is route-scoped at `/assistant` rather than globally available from the shell.
2. Frontend assistant client expects `/assistant/generate`, while backend source-of-truth contracts live under `/api/v1/ai/*`.

This plan aligns UX and API contracts to architecture invariants:

1. Unified AI gateway in backend.
2. Ontology access remains strictly read-only.
3. Evidence/caveat policy remains explicit in AI responses.

## Scope

1. Add generic assistant endpoint under canonical AI router.
2. Add backend tool policy surface that includes read-only ontology query capability.
3. Add shell-level assistant layer in `seer-ui/app/components/layout`.
4. Integrate `assistant-ui` runtime for thread/message state management.
5. Add frontend transport adapter targeting canonical backend endpoint.
6. Keep `/assistant` route as optional full-page mission control fallback.
7. Add focused backend + frontend tests for contract and safety behavior.

## Non-Goals

1. Autonomous state mutation actions by assistant.
2. Ontology authoring/edit/publish workflows.
3. Multi-tenant AI policy segmentation.
4. Rework of process/RCA feature contracts beyond assistant integration points.

## Canonical Contract Plan

### Backend Endpoint

1. Add `POST /api/v1/ai/assistant/chat`.
2. Request contract (initial):
   - `messages[]` (`role`, `content`)
   - `context` (`route`, `module`, optional `anchor_object_type`, `time_window`, `concept_uris`)
   - optional `thread_id`
3. Response contract (initial):
   - `answer`
   - `response_policy`
   - `tool_permissions[]`
   - `evidence[]`
   - `caveats[]`
   - `next_actions[]`
   - optional `tool_runs[]` metadata

### Tooling Policy

1. Read-only ontology SPARQL tool is allowed and explicit in `tool_permissions`.
2. SPARQL guardrails remain enforced by existing query guard:
   - only `SELECT` and `ASK`
   - update operations blocked
   - dataset-scoping clauses blocked
3. Tool failures must return caveats without crashing assistant response path.

### Frontend Integration

1. Shell-level assistant layer mounts once in `AppShell` and persists through route transitions.
2. Bottom-right floating trigger opens/closes panel.
3. Assistant panel uses `assistant-ui` runtime as primary thread/chat manager.
4. Transport points to canonical backend endpoint (no `/assistant/generate` dependency).
5. Route and module context are included with each assistant turn.

## Implementation Phases

## Phase 1: Contract and Dependency Foundation

**Goal:** establish stable API and runtime dependencies before UI migration.

Deliverables:

1. Add `assistant-ui` packages to `seer-ui/package.json`.
2. Define backend assistant request/response models in AI gateway domain.
3. Add API route in `seer-backend/src/seer_backend/api/ai.py`.
4. Add frontend API transport adapter for new endpoint.

Exit criteria:

1. Frontend compiles with assistant-ui dependencies installed.
2. Backend route appears in OpenAPI.
3. Contract types are shared and lint-clean.

## Phase 2: Backend Generic Assistant + Read-Only Tool Wiring

**Goal:** make backend endpoint useful across ontology/process/history contexts with safe tool access.

Deliverables:

1. Implement gateway handler for generic assistant turns.
2. Reuse ontology copilot/tool execution path for read-only SPARQL calls.
3. Map assistant output to evidence/caveat/next-action envelope.
4. Add tests for:
   - happy path response envelope,
   - read-only tool permission exposure,
   - blocked mutating SPARQL attempts,
   - tool failure caveat behavior.

Exit criteria:

1. Endpoint responds deterministically for generic prompts.
2. Read-only SPARQL is usable and guarded.
3. New backend tests pass in impacted domains.

## Phase 3: Global Shell Assistant Layer

**Goal:** deliver always-available assistant UX outside route boundaries.

Deliverables:

1. Create `GlobalAssistantLayer` UI component with:
   - floating launcher button (bottom-right),
   - panel container,
   - open/close state and keyboard escape behavior.
2. Mount layer in `AppShell` so it persists across navigation.
3. Integrate assistant-ui runtime and thread primitives.
4. Connect composer/send flow to canonical assistant endpoint transport.
5. Preserve existing `/assistant` route as fallback surface during rollout.

Exit criteria:

1. Assistant launcher visible on all routes.
2. Panel state persists while navigating between routes.
3. Messages are handled by assistant-ui runtime, not legacy custom thread state.

## Phase 4: Hardening, Migration, and Documentation Sync

**Goal:** finish migration safely and update canonical docs.

Deliverables:

1. Deprecate legacy `/assistant/generate` frontend assumptions.
2. Add/refresh UI tests for launcher, panel lifecycle, and request payload context.
3. Validate lint/build/contracts for `seer-ui` and impacted backend tests.
4. Update product + architecture docs as needed for new assistant contract.
5. Record deferred follow-ups in tech debt tracker.

Exit criteria:

1. No active dependency on legacy assistant endpoint path.
2. CI checks pass for touched modules.
3. Documentation reflects new assistant entry point and API boundary.

## Acceptance Criteria

1. Bottom-right launcher appears globally in shell and opens assistant panel.
2. Assistant panel is route-independent and persists during navigation.
3. Assistant chat state is managed through `assistant-ui`.
4. Backend exposes `POST /api/v1/ai/assistant/chat` with a generic cross-context contract.
5. Assistant can query ontology via read-only SPARQL tooling.
6. Mutating/dataset-scoped SPARQL is rejected by policy and surfaced safely.
7. AI response envelope includes tool permissions, evidence, and caveats.

## Risks and Mitigations

1. Risk: transport mismatch between assistant-ui expected payload shape and backend schema.  
   Mitigation: lock request/response schema in Phase 1 and add contract tests before UI migration.
2. Risk: global panel introduces layout regressions on smaller screens.  
   Mitigation: responsive constraints and route smoke checks for desktop/mobile breakpoints.
3. Risk: tool-calling latency harms UX.  
   Mitigation: bounded query row limits, timeout caveats, and progressive streaming follow-up in debt tracker.
4. Risk: duplicate assistant experiences (`/assistant` page and global panel) confuse users.  
   Mitigation: retain fallback temporarily, then consolidate entry points in Phase 4.

## Dependencies

1. Completion or stabilization of `docs/exec-plans/completed/post-mvp-ontology-process-readonly-adaptation.md`.
2. OpenAI runtime configuration available in backend environment.
3. Ontology service and read-only query path healthy in target environment.

## Decision Log

1. 2026-02-28: Assistant entry point will move to shell-level global layer instead of route-only UX.
2. 2026-02-28: `assistant-ui` selected as primary thread/chat state manager.
3. 2026-02-28: Generic assistant API will be added under canonical `/api/v1/ai/*` router.
4. 2026-02-28: Ontology SPARQL tool access remains read-only and enforced by existing query guard policy.
5. 2026-02-28: Legacy `/assistant` route retained as fallback during migration window.

## Completion Summary

1. Added generic assistant chat route `POST /api/v1/ai/assistant/chat` under the canonical AI gateway.
2. Added assistant chat request/context/response models and route-aware context shaping in gateway orchestration.
3. Reused ontology copilot read-only SPARQL tool path and added explicit caveat/evidence signaling for policy-blocked queries.
4. Added global shell-mounted assistant layer with bottom-right launcher and assistant-ui runtime/primitives.
5. Migrated legacy frontend assistant adapter off `/assistant/generate` to canonical assistant chat endpoint.
6. Added frontend contract checks for global assistant mounting and endpoint mapping.
7. Synced architecture/spec/readme docs for the new assistant contract and global launcher behavior.

## Acceptance Evidence

1. Backend lint: `seer-backend/.venv/bin/ruff check seer-backend/src/seer_backend/ai/gateway.py seer-backend/src/seer_backend/api/ai.py seer-backend/tests/test_ai_phase5.py` (pass).
2. Backend tests: `seer-backend/.venv/bin/pytest seer-backend/tests/test_ai_phase5.py -q` (`5 passed`, warnings only).
3. Frontend lint (touched files): `cd seer-ui && npm run lint -- app/components/assistant/global-assistant-layer.tsx app/components/layout/app-shell.tsx app/lib/api/assistant-chat.ts` (pass).

## Progress Tracking

- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete
- [x] Phase 4 complete

Current execution state:

- `completed`: all phases delivered on 2026-02-28.

## Plan Maintenance Rules

1. Update this file at each phase boundary with concrete evidence.
2. Track intentionally deferred work in `docs/exec-plans/tech-debt-tracker.md`.
3. Move plan to `docs/exec-plans/completed/` only when all acceptance criteria are satisfied.
