# Post-MVP Exec Plan: Assistant Turn Logging + Zellij Debug Panel

**Status:** completed  
**Target order:** post-MVP track 6 (developer observability)  
**Agent slot:** AI-OBS-1  
**Predecessor:** `docs/exec-plans/completed/assistant-page-surface-unification.md`  
**Successor:** TBD  
**Last updated:** 2026-03-05

---

## Objective

Improve assistant debugging for local development by adding:

1. structured backend logs for each assistant turn,
2. log events that explain turn progress, tool activity, and failures,
3. a dedicated zellij pane that shows a readable assistant-log stream.

## Why Now

Current assistant debugging is too opaque during streamed turns:

1. backend logs do not describe the lifecycle of a single assistant turn,
2. tool activity is only visible indirectly through SSE behavior,
3. the local zellij workspace has no dedicated assistant-debug surface.

This plan improves observability without changing the assistant API contract or end-user behavior.

## Scope

1. Add structured per-turn assistant logging in the backend AI gateway.
2. Add optional dedicated assistant turn log file support in backend logging bootstrap.
3. Add a small log-viewer script for readable assistant debug output.
4. Update local zellij layout to include a dedicated assistant logs pane.
5. Update developer docs for the new debugging workflow.

## Non-Goals

1. Changing assistant request/response contracts.
2. Adding persistent production log shipping/aggregation infrastructure.
3. Adding ontology/process/RCA debugging panels beyond assistant turns.
4. Reworking frontend assistant runtime behavior outside debug visibility needs.

## Implementation Phases

## Phase 1: Backend Assistant Turn Telemetry

**Goal:** emit clear structured logs for assistant turn lifecycle.

Deliverables:

1. Stable per-turn correlation fields (`turn_id`, `thread_id`).
2. Start/completion/failure log records with timing and message counts.
3. Tool-status log records for read-only tool execution events.
4. Focused backend tests for happy-path and failure-path logging.

Exit criteria:

1. A single assistant turn can be reconstructed from logs alone.
2. Tests verify key log records and fields.

## Phase 2: Local Log Surface + Dev Workflow

**Goal:** make assistant logs easy to watch during host-run local development.

Deliverables:

1. Optional assistant turn log file configuration in backend startup.
2. Readable log-viewer script for assistant JSON log lines.
3. `scripts/dev-local-zellij.sh` pane dedicated to assistant logs.
4. README/doc updates for the new pane and log location.

Exit criteria:

1. Running `./scripts/dev-local-zellij.sh` shows assistant logs in a dedicated pane.
2. Assistant pane stays readable without requiring manual JSON parsing.

## Acceptance Criteria

1. Each assistant turn logs a start record with context and prompt preview.
2. Tool activity during a turn logs explicit records with tool name/status.
3. Completion and failure records include timing and stream progress counters.
4. Assistant logs can be written to a dedicated file without changing the SSE contract.
5. Local zellij dev session includes a dedicated assistant logs pane.
6. Developer docs describe how to use the new assistant log stream.

## Risks and Mitigations

1. Risk: logging too much streamed data makes the pane noisy.  
   Mitigation: log lifecycle milestones and tool events, not every token chunk.
2. Risk: uvicorn reload or repeated startup duplicates file handlers.  
   Mitigation: make logging bootstrap idempotent and detect existing handlers.
3. Risk: prompt/answer logging leaks too much text into debug output.  
   Mitigation: log bounded previews and summary counts rather than full payloads.

## Docs Impact

1. `ARCHITECTURE.md`: no change expected; no architectural invariant changes.
2. `DESIGN.md`: no change expected; no design theme changes.
3. `README.md`: update local dev section for assistant log pane and log file path.
4. `docs/exec-plans/active/index.md`: update execution status when the plan completes.
5. `docs/exec-plans/completed/README.md`: index completed plan after archive.

## Decision Log

1. 2026-03-05: Keep assistant debugging backend-led and zellij-native rather than adding a frontend-only debug console.
2. 2026-03-05: Use structured JSON logs as the source of truth, then render them into a readable zellij view.
3. 2026-03-05: Log lifecycle milestones and tool activity per turn, but avoid per-token logs to keep signal high.

## Completion Summary

1. Added structured assistant-turn logs in the backend AI gateway with correlated `turn_id` and `thread_id` fields.
2. Logged assistant turn start, first-model-response, tool status, completion, and failure milestones with timing and bounded previews.
3. Added backend support for `SEER_ASSISTANT_TURN_LOG_PATH` so assistant logs can stream to a dedicated JSONL file.
4. Added `scripts/render_assistant_turn_logs.py` to convert assistant JSON logs into a readable terminal stream.
5. Updated `scripts/dev-local-zellij.sh` to provision a dedicated `assistant-logs` pane that tails the assistant log stream.
6. Updated developer docs in the root README and backend README for the new assistant logging workflow.

## Acceptance Evidence

1. Backend lint: `seer-backend/.venv/bin/ruff check seer-backend/src/seer_backend/ai/gateway.py seer-backend/src/seer_backend/logging.py seer-backend/src/seer_backend/config/settings.py seer-backend/src/seer_backend/main.py seer-backend/tests/test_ai_phase5.py` (pass).
2. Backend tests: `seer-backend/.venv/bin/pytest -q seer-backend/tests/test_ai_phase5.py` (`13 passed`).
3. Zellij script syntax: `bash -n scripts/dev-local-zellij.sh` (pass).
4. Log viewer syntax: `python3 -m py_compile scripts/render_assistant_turn_logs.py` (pass).

## Progress Tracking

- [x] Phase 1 complete
- [x] Phase 2 complete

Current status:

1. Phase 1 complete.
2. Phase 2 complete.
