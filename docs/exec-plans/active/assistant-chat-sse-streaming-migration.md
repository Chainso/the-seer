# Post-MVP Exec Plan: Assistant Chat SSE Streaming Migration

**Status:** in_progress  
**Target order:** post-MVP track 4  
**Agent slot:** AI-STREAM-1  
**Predecessor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/global-assistant-layer-and-generic-ai-endpoint.md`  
**Successor:** TBD  
**Last updated:** 2026-03-01

---

## Objective

Switch the canonical assistant endpoint from request/response JSON to SSE streaming and update UI runtime/storage to consume streamed events while preserving full completions-format message history (including tool-call/tool-result messages and assistant reasoning artifacts when available).

## Compatibility Stance

1. No backward compatibility shim for JSON assistant responses.
2. `POST /api/v1/ai/assistant/chat` becomes SSE-first and authoritative.
3. Legacy non-streaming assumptions in UI transport/state are removed.

## Why This Work

Current assistant behavior sends one final JSON payload per turn. This causes:

1. No token-level progressive rendering.
2. Weak continuity across reloads unless full completion history is preserved.
3. Higher perceived latency during tool-heavy turns.

SSE migration aligns with assistant UX goals: faster perceived response, better traceability, and explicit persistence of tool/evidence context.

## Scope

1. Migrate backend `/api/v1/ai/assistant/chat` to SSE response contract.
2. Stream assistant output deltas and lifecycle events from backend.
3. Stream-consume in UI and render incremental assistant text.
4. Persist returned completions-format message history in local storage.
5. Keep tool-call/tool-result continuity across turns by replaying completion messages.
6. Update tests/docs for new streaming contract.

## Non-Goals

1. Migrating ontology-only `/api/v1/ontology/copilot` to SSE in this plan.
2. Introducing websocket transport.
3. Adding multi-model arbitration or speculative decoding.

## Canonical Streaming Contract

Endpoint:

1. `POST /api/v1/ai/assistant/chat`
2. `Content-Type: text/event-stream`

Client request body:

1. `completion_messages[]` (OpenAI Chat Completions-style message objects; authoritative)
2. `messages[]` remains accepted only as transitional request input during rollout; removed by Phase 4.
3. `context`, `thread_id` unchanged.

SSE events (ordered):

1. `meta`
   - `thread_id`, `module`, `task`, `response_policy`, `tool_permissions`
2. `assistant_delta`
   - `text` chunk to append to in-progress assistant message
3. `tool_status` (optional)
   - tool call started/completed/failure summary
4. `final`
   - final envelope (`answer`, `evidence`, `caveats`, `next_actions`, `copilot`)
   - canonical `completion_messages[]` for storage/replay
5. `error` (terminal if emitted)
6. `done` (terminal success marker)

Rules:

1. `final` must always include full `completion_messages[]`.
2. `done` is emitted only after `final`.
3. On error, stream emits `error` and closes without `done`.

## Phase Plan

## Phase 1: Backend SSE Endpoint Contract

**Goal:** convert assistant endpoint transport to SSE with deterministic event framing.

Deliverables:

1. Replace JSON response route behavior for `/api/v1/ai/assistant/chat` with SSE emitter.
2. Implement event schema serializers (`meta`, `assistant_delta`, `tool_status`, `final`, `done`, `error`).
3. Keep thread id generation and policy/tool-permission metadata in `meta`.
4. Ensure `final` contains full `completion_messages[]` for client persistence.

Exit criteria:

1. Endpoint returns `text/event-stream`.
2. Event order and payload schema are stable and tested.
3. Error path emits structured `error` event.

Validation:

1. `cd seer-backend && uv run ruff check src/seer_backend/api/ai.py src/seer_backend/ai/gateway.py`
2. `cd seer-backend && uv run pytest -q tests/test_ai_phase5.py -k assistant_chat`

## Phase 2: Copilot Streaming Orchestration

**Goal:** stream assistant content while preserving tool loop and completion history fidelity.

Deliverables:

1. Add streaming orchestration path in ontology copilot service.
2. Emit `assistant_delta` chunks for user-visible answer text.
3. Emit `tool_status` events when tool calls are executed.
4. Preserve full `completion_messages_delta` accumulation and produce final completion history.

Exit criteria:

1. Multi-round tool turns still complete under read-only guardrails.
2. Final completion history includes tool-call and tool-result messages.
3. Streaming path and non-streaming internals do not diverge on policy behavior.

Validation:

1. `cd seer-backend && uv run ruff check src/seer_backend/ai/ontology_copilot.py`
2. `cd seer-backend && uv run pytest -q tests/test_ontology_phase1.py tests/test_ai_phase5.py -k \"copilot or assistant_chat\"`

## Phase 3: UI SSE Consumer + Incremental Rendering

**Goal:** render assistant text as stream arrives and persist final completion history.

Deliverables:

1. Replace JSON `postAssistantChat` fetch path with SSE stream parser in assistant state.
2. Append `assistant_delta` chunks into an in-progress assistant message.
3. On `final`, persist canonical `completion_messages[]` into local storage thread state.
4. Preserve thread-level running/error handling with stream cancellation support.

Exit criteria:

1. Assistant panel visibly streams tokens/chunks.
2. Reloaded thread retains completion history and tool context continuity.
3. UI no longer assumes JSON response shape from `/ai/assistant/chat`.

Validation:

1. `cd seer-ui && npm run lint -- app/lib/api/assistant-chat.ts app/components/assistant/shared-assistant-state.tsx`
2. `cd seer-ui && npm run test:contracts`

## Phase 4: Hardening and Contract Cleanup

**Goal:** remove transitional paths and lock final SSE-only contract.

Deliverables:

1. Remove `messages[]` fallback request handling (completion messages only).
2. Remove obsolete non-stream code paths and dead adapters.
3. Add/refresh backend contract tests for event ordering and terminal semantics.
4. Add docs updates for assistant streaming contract and persistence model.

Exit criteria:

1. Single canonical SSE contract in code and docs.
2. No production path depends on legacy JSON assistant response behavior.
3. Validation suite passes for impacted domains.

Validation:

1. `cd seer-backend && uv run pytest -q tests/test_ai_phase5.py`
2. `cd seer-backend && uv run ruff check .`
3. `cd seer-ui && npm run lint`
4. `cd seer-ui && npm run build`
5. `cd seer-ui && npm run test:contracts`

## Acceptance Criteria

1. Assistant endpoint streams SSE events on every turn.
2. UI shows incremental assistant output before final event.
3. Final event returns canonical completions-format history including tool call/result context.
4. UI local storage persists completion history and replays it on subsequent turns.
5. Tool-heavy conversations no longer lose prior tool evidence on reload.
6. Non-streaming JSON response path is removed from canonical assistant route.

## Risks and Mitigations

1. Risk: partial streams leave inconsistent thread state.  
   Mitigation: explicit `error` event handling + only persist `completion_messages` from `final`.
2. Risk: tool rounds delay first visible tokens.  
   Mitigation: emit `tool_status` events and early assistant preamble deltas.
3. Risk: event parser drift between backend and UI.  
   Mitigation: backend event contract tests + UI parser unit-level assertions.
4. Risk: oversized completion history in browser storage.  
   Mitigation: hard cap retained completion message count per thread.

## Decision Log

1. 2026-03-01: `POST /api/v1/ai/assistant/chat` will be SSE-only; JSON response compatibility is intentionally dropped.
2. 2026-03-01: `completion_messages[]` is canonical persisted conversation state, not optional metadata.
3. 2026-03-01: client-provided `system` completion messages remain ignored (backend-owned prompts only).
4. 2026-03-01: Phase 1 SSE contract emits ordered events `meta -> assistant_delta* -> final -> done`; failures emit terminal `error` without `done`.
5. 2026-03-01: Phase 2 added gateway/copilot streaming orchestration so assistant chat now emits runtime `tool_status` lifecycle events (started + completed/failed), streams answer deltas from the orchestration path, and preserves canonical final `completion_messages[]`.

## Progress Tracking

- [x] Phase 1 complete
- [x] Phase 2 complete
- [ ] Phase 3 complete
- [ ] Phase 4 complete

Current execution state:

- `completed`: Phase 1 backend SSE endpoint migration implemented and validated (`ruff` + `pytest -k assistant_chat`).
- `completed`: Phase 2 copilot streaming orchestration implemented in backend (`ontology_copilot` stream events, gateway forwarding, API SSE passthrough, assistant chat tests updated).
- `in_progress`: Phase 3 UI SSE consumer + incremental rendering.

## Documentation Update Targets

When completed, update in same change set:

1. `ARCHITECTURE.md` (assistant transport contract and persistence implications).
2. Relevant completed/active exec plan status files and indexes.
3. Any assistant product spec pages describing interaction behavior.
