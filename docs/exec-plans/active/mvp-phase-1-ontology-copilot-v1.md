# MVP Phase 1 Exec Plan: Ontology Ingestion and Copilot v1

**Status:** in_progress  
**Target order:** 1 of 6  
**Agent slot:** A2  
**Predecessor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-0-foundation-skeleton.md`  
**Successor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/active/mvp-phase-2-event-history-ingestion.md`
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
   - tool-call executor for read-only SPARQL query requests emitted in model output.
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
8. No UI path permits ontology mutation.

## Handoff Package to Phase 2

1. Ontology API contract documentation (request/response examples).
2. Fuseki graph naming and pointer conventions.
3. SHACL fixture set (valid + invalid) and test commands.
4. Copilot ontology tool contracts and safety constraints.
5. Gemini CLI invocation contract (prompt assembly, output schema, error/fallback behavior).
6. Copilot tool/output schema for read-only SPARQL query requests and validation failures.
7. Known ontology ingestion limitations to avoid impacting event ingestion.

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
