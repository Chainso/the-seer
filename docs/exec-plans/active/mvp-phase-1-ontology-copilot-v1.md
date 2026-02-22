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
   - read-only SPARQL tool invocation.
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
6. No UI path permits ontology mutation.

## Handoff Package to Phase 2

1. Ontology API contract documentation (request/response examples).
2. Fuseki graph naming and pointer conventions.
3. SHACL fixture set (valid + invalid) and test commands.
4. Copilot ontology tool contracts and safety constraints.
5. Known ontology ingestion limitations to avoid impacting event ingestion.

## Risks and Mitigations

1. **Risk:** unsafe or unbounded SPARQL from AI prompts.  
   **Mitigation:** use read-only wrappers + allowlisted query patterns.
2. **Risk:** accidental pointer drift during ingest failures.  
   **Mitigation:** strict transaction ordering and pointer-switch tests.
