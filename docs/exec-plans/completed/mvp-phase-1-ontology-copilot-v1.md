# MVP Phase 1 Exec Plan: Ontology Ingestion and Copilot v1

**Status:** completed  
**Target order:** 1 of 6  
**Agent slot:** A2  
**Predecessor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-0-foundation-skeleton.md`  
**Successor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-2-event-history-ingestion.md`
**Last updated:** 2026-02-22

---

## Objective

Deliver deterministic ontology ingestion, SHACL validation, Fuseki upsert behavior, and the first AI workflow (read-only ontology copilot).

## Scope

1. Backend ontology ingest endpoint for Prophet-generated Turtle.
2. SHACL validation against Prophet base metamodel.
3. Fuseki named-graph upsert with deterministic identity behavior.
4. Read-only SPARQL query service for UI and AI tools.
5. UI read-only ontology explorer.
6. UI ontology copilot chat surface using backend tools.

## Non-Goals

1. Ontology editing/publishing in UI.
2. Advanced ontology governance workflows.
3. Non-Prophet ontology compatibility broadening.

## Ambiguities Resolved

1. **SHACL engine:** use `pyshacl` in backend validation path.
2. **Graph release identity:** every ingest call must include `release_id`; graph IRI format is `urn:seer:ontology:release:{release_id}`.
3. **Current graph pointer:** maintain pointer in metadata graph `urn:seer:ontology:meta`; update pointer only after successful SHACL validation.
4. **Re-ingest semantics:** ingesting same `release_id` replaces that release graph atomically.
5. **Copilot query scope:** read-only SPARQL only; no update/delete operations are exposed to AI tools.
6. **Evidence policy:** analytical ontology claims must include URI references and query-backed evidence snippets.
7. **Copilot model runtime (pivot):** backend invokes Gemini CLI directly in headless mode (`gemini -p ...`) instead of calling a separate model SDK in this phase.
8. **Copilot output contract (pivot):** backend requests structured CLI output via `--output-format json` and validates it against backend response schema before returning to UI.
9. **Conversation context (pivot):** full chat history plus ontology evidence context is passed in the headless prompt for each copilot turn.
10. **Copilot tool/output option (required):** structured output must support a tool-call path where the model can request one read-only SPARQL query; backend executes only if query passes read-only guardrails.
11. **Tool execution response contract (required):** when a read-only SPARQL tool call is emitted and executed, backend must return query results in the copilot API response payload.

## Pivot Update (2026-02-22)

Copilot v1 execution path is now explicitly CLI-driven:

1. Backend constructs a single prompt containing:
   - conversation history,
   - ontology context,
   - read-only SPARQL evidence snippets.
2. Backend executes Gemini CLI headless:
   - `gemini -p "<prompt>" --output-format json`
3. Backend parses/validates JSON output and maps it to copilot API response fields.
4. Any command/query generation from model output remains read-only and constrained by SPARQL guardrails.
5. Structured output supports two response paths:
   - direct answer path (no tool call),
   - tool-call path with a read-only SPARQL query request.
6. For tool-call path, backend executes the validated query and returns structured query results to the client response.

Research notes used for this pivot:
1. Local Gemini CLI help confirms `-p/--prompt` for non-interactive mode.
2. Local Gemini CLI help confirms `-o/--output-format` supports `text`, `json`, and `stream-json`.

## Implementation Steps

1. Implement ontology ingest API contract:
   - input: Turtle content + `release_id`,
   - output: validation status + graph identifiers + diagnostics.
2. Implement validation pipeline:
   - load Prophet base metamodel,
   - run SHACL,
   - return actionable violation diagnostics.
3. Implement Fuseki upsert service:
   - write/replace release graph,
   - switch current pointer on successful validation only.
4. Implement read-only SPARQL service:
   - backend query wrapper,
   - allowlisted query templates for common ontology exploration patterns.
5. Implement ontology copilot tool layer:
   - context assembly from base metamodel + current release graph,
   - read-only SPARQL tool invocation,
   - Gemini CLI adapter that calls `gemini -p "<full prompt>" --output-format json`,
   - structured output validation/parsing before API response,
   - tool-call executor for read-only SPARQL query requests emitted in model output,
   - response mapper that includes SPARQL result rows/metadata in the copilot response.
6. Implement UI surfaces:
   - read-only ontology explorer,
   - copilot chat with concept context handoff.
7. Add tests:
   - valid ontology fixture pass,
   - invalid fixture SHACL fail,
   - deterministic re-ingest behavior,
   - read-only query enforcement.

## Acceptance Criteria

1. Valid Prophet Turtle ingest succeeds and updates current graph pointer.
2. Invalid Turtle/metamodel mismatch fails with clear SHACL diagnostics.
3. Re-ingest of identical `release_id` is deterministic and does not duplicate state.
4. UI can browse ontology concepts in read-only mode.
5. Copilot answers ontology questions with SPARQL-backed context.
6. Copilot backend execution path is Gemini CLI headless mode with validated JSON output mapping.
7. Copilot supports structured tool/output mode where model can emit one read-only SPARQL query request that is backend-validated before execution.
8. When tool-call mode is used, backend executes the query and sends structured SPARQL results back in the response.
9. No UI path permits ontology mutation.

## Handoff Package to Phase 2

1. Ontology API contract documentation (request/response examples).
2. Fuseki graph naming and pointer conventions.
3. SHACL fixture set (valid + invalid) and test commands.
4. Copilot ontology tool contracts and safety constraints.
5. Gemini CLI invocation contract (prompt assembly, output schema, error/fallback behavior).
6. Copilot tool/output schema for read-only SPARQL query requests and validation failures.
7. Copilot response schema for returning SPARQL query results (variables, rows, truncation/error fields).
8. Known ontology ingestion limitations to avoid impacting event ingestion.

## Risks and Mitigations

1. **Risk:** unsafe or unbounded SPARQL from AI prompts.  
   **Mitigation:** use read-only wrappers + allowlisted query patterns.
2. **Risk:** accidental pointer drift during ingest failures.  
   **Mitigation:** strict transaction ordering and pointer-switch tests.
3. **Risk:** Gemini CLI version drift or unavailable binary in runtime environments.  
   **Mitigation:** add startup/config checks for CLI presence and pin/document required CLI version.
4. **Risk:** malformed/non-conforming structured output from model.  
   **Mitigation:** strict JSON schema validation with explicit fallback error handling.
5. **Risk:** model emits unsafe SPARQL in tool-call output.  
   **Mitigation:** enforce read-only query guard + reject on forbidden clauses before execution.
6. **Risk:** oversized query results degrade response latency/usability.  
   **Mitigation:** enforce row/time limits with truncation indicators in returned result payload.

## Completion Summary

1. Implemented ontology ingest API with deterministic `release_id` graph naming, SHACL validation via `pyshacl`, and current-pointer switching only on successful validation.
2. Implemented read-only ontology query APIs (`current`, `concepts`, `concept-detail`, `query`) with strict read-only SPARQL guardrails.
3. Implemented Gemini CLI headless copilot runtime contract using `gemini -p "<prompt>" --output-format json` and strict structured-output validation.
4. Implemented structured copilot response modes:
   - `direct_answer`
   - `tool_call` with one read-only SPARQL tool request.
5. Implemented backend tool-call execution path that validates and runs read-only SPARQL, then returns structured query results (`variables`, `rows`, `row_count`, `truncated`, `graphs`, `error`) in copilot API responses.
6. Delivered read-only ontology explorer + copilot UI surface with no ontology mutation actions.

## Decision Log

1. Gemini runtime dependency failures are isolated to copilot runtime (`503` on `/ontology/copilot`) while ontology ingest/read services remain available.
2. SPARQL read-only guard blocks mutation and dataset-scoping clauses (`INSERT/DELETE/...`, `FROM`, `GRAPH`, `SERVICE`, `WITH`, `USING`) to reduce unsafe prompt execution risk.
3. Copilot tool-call execution returns structured failure payloads instead of hard API failures when tool queries are rejected or runtime execution errors occur.

## Acceptance Evidence

1. `cd seer-backend && uv run ruff check .`  
   Result: `All checks passed!`
2. `cd seer-backend && uv run pytest -q`  
   Result: `12 passed` (includes copilot structured output/tool-call tests and Gemini CLI subprocess contract test).
3. `cd seer-ui && npm run lint`  
   Result: `eslint` passed.
4. `cd seer-ui && npm run build`  
   Result: Next.js production build passed; `/ontology` route generated successfully.

## Doc Updates

1. Updated this phase plan with pivot details, tool-call response contract, completion summary, evidence, and phase handoff context.
2. Execution index and roadmap references were updated in the same change to reflect Phase 1 completion and Phase 2 start.

## Known Issues

1. Backend startup logs use FastAPI `on_event("startup")`, which emits deprecation warnings; migration to lifespan handlers is deferred as non-blocking technical debt.
2. Gemini CLI binary availability remains an environment prerequisite for live copilot responses; when missing, API returns explicit dependency-unavailable responses for copilot calls.

## Next-Phase Starter Context

1. Phase 1 backend API surface:
   - `seer-backend/src/seer_backend/api/ontology.py`
   - `seer-backend/src/seer_backend/ontology/service.py`
   - `seer-backend/src/seer_backend/ontology/repository.py`
2. Copilot runtime and schema contracts:
   - `seer-backend/src/seer_backend/ai/ontology_copilot.py`
   - `seer-backend/src/seer_backend/ontology/models.py`
   - `seer-backend/src/seer_backend/ontology/query_guard.py`
3. Phase 1 test fixtures and acceptance tests:
   - `seer-backend/tests/test_ontology_phase1.py`
   - `seer-backend/tests/fixtures/ontology_invalid_missing_name.ttl`
4. UI ontology read-only integration:
   - `seer-ui/src/components/ontology-workbench.tsx`
   - `seer-ui/src/lib/backend-ontology.ts`
