# Post-MVP Exec Plan: Ontology Copilot Migration to OpenAI Python Client

**Status:** in_progress  
**Target order:** post-MVP track 2  
**Agent slot:** AI-BE1  
**Predecessor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-5-ai-hardening-release.md`  
**Successor:** TBD (post-MVP plan chain)  
**Last updated:** 2026-02-23

---

## Objective

Replace the ontology copilot model runtime from headless Gemini CLI subprocess execution to the official OpenAI Python client, configured to call a local OpenAI Chat Completions endpoint via environment variable with:

1. `SEER_OPENAI_BASE_URL=http://localhost:8787/v1`
2. `chat.completions` API path (`POST /chat/completions`)

Resulting request target: `http://localhost:8787/v1/chat/completions`.

## Why This Plan Exists

Current copilot behavior is tied to host Gemini CLI availability and host auth passthrough in Docker. This creates runtime coupling that is not required for a local OpenAI Chat Completions endpoint deployment.

This plan moves model invocation to SDK-based HTTP calls with explicit backend config so model runtime is controlled by backend environment, not host CLI state.

## Current Implementation Snapshot

1. Runtime adapter and prompt contract are in `seer-backend/src/seer_backend/ai/ontology_copilot.py` (`GeminiCliSubprocessRuntime` + JSON parsing).
2. Runtime wiring and dependency fallback are in `seer-backend/src/seer_backend/api/ontology.py` (`build_ontology_services`).
3. Runtime config is in `seer-backend/src/seer_backend/config/settings.py` (`SEER_GEMINI_*` fields).
4. Copilot runtime contract tests are in `seer-backend/tests/test_ontology_phase1.py`.
5. Gemini host passthrough docs/config live in:
   - `docker-compose.yml`
   - `.env.example`
   - `seer-backend/.env.example`
   - `README.md` (Host Gemini section)

## Architectural Guardrails (Must Hold)

1. Ontology copilot remains read-only and may only execute guarded SPARQL `SELECT`/`ASK` tool calls.
2. Backward compatibility is not required for copilot runtime or response contracts; optimize for the cleanest target design.
3. Ontology ingest/read services remain available even if model runtime dependency is down.
4. Any changed product/design/architecture invariant must be reflected in `VISION.md` / `DESIGN.md` / `ARCHITECTURE.md` in the same change.

## Scope

1. Introduce official OpenAI Python SDK dependency in backend package.
2. Add OpenAI runtime settings with `SEER_`-prefixed env vars:
   - `SEER_OPENAI_BASE_URL` (required base URL, e.g. `http://localhost:8787/v1`),
   - `SEER_OPENAI_MODEL` (model id),
   - `SEER_OPENAI_API_KEY` (optional/defaulted for local compatible endpoints),
   - `SEER_OPENAI_TIMEOUT_SECONDS` (request timeout).
3. Replace Gemini-specific runtime adapter with OpenAI-client runtime adapter in copilot service wiring.
4. Preserve prompt + structured output validation behavior for copilot responses.
5. Update backend tests to validate OpenAI client invocation contract and fallback behavior.
6. Update Docker/env/README docs for local endpoint configuration.
7. Remove Gemini CLI-specific runtime wiring from compose/env docs when migration is complete.
8. Allow updates to `/api/v1/ontology/copilot` and `/api/v1/ai/ontology/question` contracts if they improve copilot quality and operability.

## Non-Goals

1. Expanding scope to process or RCA AI runtimes.
2. Preserving Gemini-era API/response compatibility for copilot.
3. Introducing multi-provider routing or dynamic provider selection in this plan.
4. Reworking AI gateway envelope semantics or UI behavior.
5. Adding ontology mutation capability.

## Execution Phases

## Phase A: Runtime Contract and Config Design

**Goal:** finalize the SDK call contract and env var surface before code changes.

Deliverables:

1. Lock OpenAI SDK API path to `chat.completions` per endpoint compatibility requirement.
2. Define final settings schema and defaults in `Settings`.
3. Define the target copilot response/behavior contract (breaking changes allowed).
4. Decide timeout and error mapping semantics equivalent to existing ontology dependency errors.

Exit criteria:

1. Runtime contract documented in this plan decision log.
2. Env var names and defaults fixed for implementation.

## Phase B: Copilot Runtime Refactor

**Goal:** replace Gemini subprocess runtime with OpenAI-client runtime in ontology copilot module.

Deliverables:

1. Replace Gemini runtime protocol/types with provider-neutral naming (model runtime adapter abstraction).
2. Implement OpenAI runtime adapter using official client against `SEER_OPENAI_BASE_URL`.
3. Keep strict JSON parsing + schema validation path for `CopilotStructuredOutput`.
4. Preserve existing tool-call execution and read-only query safeguards.

Exit criteria:

1. Ontology copilot end-to-end behavior matches the target contract defined in Phase A.
2. Runtime errors map to existing `OntologyError` / `OntologyDependencyUnavailableError` semantics.

## Phase C: Service Wiring and Dependency Behavior

**Goal:** wire OpenAI runtime during app startup and retain graceful dependency degradation.

Deliverables:

1. Update `build_ontology_services` in `seer-backend/src/seer_backend/api/ontology.py` to build OpenAI runtime from settings.
2. Remove `which(gemini)` binary checks and replace with base URL/config validation.
3. Keep fallback runtime behavior so ontology ingest/read remain available if AI runtime is unavailable.

Exit criteria:

1. App startup succeeds when ontology dependencies are present.
2. Copilot returns dependency-unavailable behavior on missing/unreachable model endpoint without breaking ontology routes.

## Phase D: Tests, Dependency, and Documentation

**Goal:** align automated tests and operator docs with the new runtime.

Deliverables:

1. Add/update backend dependency in `seer-backend/pyproject.toml`.
2. Update tests in `seer-backend/tests/test_ontology_phase1.py`:
   - runtime invocation contract assertions for OpenAI client path,
   - target copilot response contract assertions,
   - fallback behavior tests for missing OpenAI config or endpoint unavailability.
3. Update env templates and runtime docs:
   - `.env.example`,
   - `seer-backend/.env.example`,
   - `README.md`,
   - `docker-compose.yml` (including host endpoint reachability guidance for containerized backend).
4. Remove stale Gemini-host-passthrough documentation references.

Exit criteria:

1. Tests pass with updated runtime contract.
2. Setup docs provide a single, correct path for local endpoint usage.

## Phase E: Validation and Handoff

**Goal:** verify migration outcomes and capture operational handoff notes.

Deliverables:

1. Execute verification commands and record pass/fail evidence.
2. Record known limitations and follow-up debt in `docs/exec-plans/tech-debt-tracker.md` if needed.
3. Document completion summary and move plan to `docs/exec-plans/completed/` when acceptance criteria pass.

Exit criteria:

1. Acceptance criteria below all satisfied.
2. Active index updated to completed status after move.

## Acceptance Criteria

1. Ontology copilot runtime uses official OpenAI Python client (no Gemini CLI subprocess path in active backend wiring).
2. Endpoint URL is driven by environment variable (`SEER_OPENAI_BASE_URL=http://localhost:8787/v1`) and requests resolve to `/chat/completions`.
3. Copilot contract reflects the new target design defined in Phase A (breaking changes permitted).
4. Read-only SPARQL tool safety guarantees remain enforced.
5. Runtime unavailability handling remains explicit and isolated to copilot calls.
6. Backend tests for runtime path and new copilot behavior pass.
7. Compose/env/README docs no longer require Gemini host passthrough for copilot runtime.

## Verification Plan

1. `cd seer-backend && uv run pytest -q tests/test_ontology_phase1.py`
2. `cd seer-backend && uv run pytest -q`
3. `cd seer-backend && uv run ruff check src tests`
4. Manual smoke:
   - ingest ontology,
   - call `/api/v1/ontology/copilot`,
   - call `/api/v1/ai/ontology/question`,
   - validate expected dependency error behavior when endpoint is intentionally unavailable.

## Risks and Mitigations

1. Risk: Dockerized backend cannot reach host `localhost:8787`.  
   Mitigation: document and configure host mapping path (for example `host.docker.internal` strategy) in compose guidance.
2. Risk: structured-output reliability differs from Gemini CLI JSON mode.  
   Mitigation: preserve strict schema validation and add regression tests for invalid/non-JSON model output.
3. Risk: hidden references to Gemini runtime remain in docs/config.  
   Mitigation: run repo-wide grep checks during implementation and clear stale references.

## Initial Decision Log

1. Scope is a direct runtime migration for ontology copilot only.
2. Runtime URL must be environment-driven and use `SEER_OPENAI_BASE_URL=http://localhost:8787/v1`.
3. Model calls must use OpenAI `chat.completions`, producing `POST /v1/chat/completions`.
4. Official OpenAI Python SDK is required for model invocation.
5. Backward compatibility is intentionally not required; optimize for the best target copilot experience while preserving read-only safety.
6. Target copilot contract for this migration keeps existing response models (`CopilotChatResponse`) while replacing runtime internals; breaking changes remain allowed in future follow-up.

## Phase A Completion Notes (2026-02-23)

1. Locked provider/runtime contract to OpenAI official Python client using `chat.completions`.
2. Locked endpoint/base URL contract to `SEER_OPENAI_BASE_URL=http://localhost:8787/v1` with resolved target `POST /v1/chat/completions`.
3. Locked migration approach to keep current copilot response schema in this pass while removing Gemini runtime coupling.

## Progress Tracking

- [x] Phase A complete
- [ ] Phase B complete
- [ ] Phase C complete
- [ ] Phase D complete
- [ ] Phase E complete

Current execution state:

- `in_progress`: Phase B (copilot runtime refactor)
- `completed`: Phase A (runtime contract + settings lock)

## Plan Maintenance Rules

1. Update this file at each phase boundary with completion notes and evidence.
2. Record any deferrals in `docs/exec-plans/tech-debt-tracker.md`.
3. Move this file to `docs/exec-plans/completed/` only after acceptance criteria pass and evidence is captured.
