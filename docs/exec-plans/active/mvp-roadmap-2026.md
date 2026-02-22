# Seer MVP Roadmap and Execution Plan

**Status:** Canonical MVP execution plan  
**Date:** 2026-02-22  
**Parent strategy:** `/home/chanzo/code/large-projects/seer-python/VISION.md`

---

## 1. Purpose

This document translates Seer's product vision into a clear MVP execution roadmap.

This roadmap is intentionally execution-focused:
- what gets built,
- in what order,
- what must be true to exit each phase,
- and how to prevent scope drift.

---

## 2. MVP Outcome

The MVP is successful when Seer can:
1. Ingest Prophet local ontology Turtle files.
2. Validate ontology against Prophet base metamodel using SHACL.
3. Upsert ontology definitions into Fuseki with deterministic URI-based identity behavior.
4. Provide read-only ontology exploration and ontology copilot Q&A in UI.
5. Ingest events into ClickHouse with UUID event IDs.
6. Persist object snapshots with UUID object history IDs.
7. Persist event-object links connecting event UUIDs to object history UUIDs plus normalized object refs.
8. Run object-centric Petri net analysis using `pm4py` over Arrow-backed ClickHouse extracts.
9. Run root-cause analysis with pluggable neighborhood extraction (iterative SQL first).
10. Present AI-assisted, evidence-backed analytical insights in product workflows.

---

## 3. MVP Non-Goals

The MVP explicitly excludes:
1. Ontology authoring in Seer UI.
2. Multi-tenant data-layer concerns.
3. Heavy reliability systems (dead-letter orchestration, replay subsystem, schema/version governance).
4. Governance/trust-center product modules.
5. Broad mining-method coverage beyond object-centric Petri nets.

---

## 4. Monorepo Delivery Model

All MVP components live in one repository.

Baseline layout intent:
- `docker/`
- `seer-backend/`
- `seer-ui/`
- `docs/` (optional)
- `libs/` (optional shared code)

Operating rule:
- Any cross-component change (backend API + UI usage + Docker/runtime config) lands in one coordinated PR when feasible.

---

## 5. Workstreams

## 5.1 Ontology Workstream

Scope:
- Turtle ingestion,
- SHACL validation,
- Fuseki upsert,
- read-only query APIs.

Outputs:
- ontology ingestion endpoints,
- ontology query endpoints,
- ontology copilot query tools.

## 5.2 History and Ingestion Workstream

Scope:
- event ingestion API,
- ClickHouse persistence for `event_history`, `object_history`, `event_object_links`,
- object-ref normalization.

Outputs:
- ingestion service,
- normalized storage writes,
- timeline/query APIs.

## 5.3 Analytics Workstream

Scope:
- Arrow-based extraction,
- object-centric Petri net generation with `pm4py`,
- RCA pipeline (neighborhood extraction + ranking).

Outputs:
- process mining service,
- RCA service,
- structured insight results.

## 5.4 AI Experience Workstream

Scope:
- ontology copilot (first AI workflow),
- process and RCA assistant surfaces,
- answer formatting by claim type.

Outputs:
- conversational UX integrations,
- tool orchestration contracts,
- response rendering contracts.

## 5.5 UI Workstream

Scope:
- read-only ontology explorer,
- ingestion monitor,
- process explorer,
- root cause lab,
- insights dashboard.

Outputs:
- production-ready core screens for MVP scope.

---

## 6. Phase Plan

## Phase 0: Foundation and Skeleton

### Goal

Stand up the monorepo, runtime environments, and service skeletons with minimal end-to-end plumbing.

### Scope

1. Create monorepo directory skeleton.
2. Create Docker Compose runtime for Seer backend, Seer UI, Fuseki, ClickHouse.
3. Implement backend service scaffolding and health endpoints.
4. Implement UI shell with module routing.
5. Wire environment configs and local startup docs.

### Exit Criteria

1. One command starts all required local services.
2. Backend and UI communicate in local environment.
3. Fuseki and ClickHouse are reachable from backend.
4. CI/basic checks run for backend and UI.

### Key Risks

1. Startup complexity from cross-service config drift.
2. Unclear environment assumptions across contributors.

### Mitigations

1. Commit known-good `.env.example` and service defaults.
2. Add a deterministic local startup script.

---

## Phase 1: Ontology Ingestion + Ontology Copilot v1

### Goal

Deliver deterministic ontology ingestion and the first AI workflow (read-only ontology conversation).

### Scope

Backend:
1. Implement endpoint to ingest Prophet-generated Turtle.
2. Run SHACL validation against Prophet base metamodel.
3. Implement URI-based upsert identity behavior in Fuseki named graphs.
4. Implement read-only SPARQL query APIs and utility query templates.

AI:
5. Implement ontology copilot toolchain with read-only SPARQL execution.
6. Add ontology context assembly (base metamodel + local ontology graph).
7. Return URI-backed responses and query evidence when claims are analytical.

UI:
8. Ship read-only ontology explorer view.
9. Ship ontology copilot chat surface.
10. Wire concept selection to conversational context.

### Exit Criteria

1. A valid Turtle file can be ingested and persisted.
2. Invalid ontology fails SHACL with actionable diagnostics.
3. Re-ingest behavior is deterministic for same ontology release.
4. User can ask ontology questions and receive SPARQL-backed responses.
5. No UI path allows ontology editing.

### Dependencies

1. Fuseki runtime and SHACL tooling available.
2. Prophet base metamodel (`prophet.ttl`) accessible in backend context.

### Key Risks

1. SPARQL response quality degradation from unconstrained prompts.
2. Ambiguous graph replacement behavior.

### Mitigations

1. Use read-only query templates and bounded query generation.
2. Keep explicit named-graph replacement rules in code and tests.

---

## Phase 2: Event Ingestion + History Data Model

### Goal

Establish complete historical storage primitives using UUID identities and normalized object references.

### Scope

Schema:
1. Implement `event_history` with UUID `event_id`.
2. Implement `object_history` with UUID `object_history_id` and full object snapshots.
3. Implement `event_object_links` with event UUID + object history UUID + normalized object refs.

Ingestion:
4. Parse incoming event payloads.
5. Enforce required-field checks and UUID shape checks for `event_id`.
6. Reject duplicate `event_id`.
7. Extract object snapshots from `updated_objects` and/or payload-mapped refs.
8. Persist normalized object ref fields (`object_ref_canonical`, `object_ref_hash`).
9. Persist event-object link rows.

APIs:
10. Add baseline query endpoints for event and object timelines.
11. Add query by object type/ref hash and event type/time range.

### Exit Criteria

1. Events are persisted with UUID event IDs.
2. Object snapshots are persisted with UUID history IDs.
3. Links correctly join events to specific object snapshot UUIDs.
4. Object type consistency between links and history is enforced.
5. `occurred_at` is the default event-time basis in user-facing analytics APIs.

### Dependencies

1. Stable ClickHouse connection and migration setup.
2. Clear event payload parsing/mapping utilities.

### Key Risks

1. Incorrect object-ref normalization causing join misses.
2. Snapshot extraction edge cases from heterogeneous payloads.

### Mitigations

1. Canonicalization tests for composite refs.
2. Golden test fixtures with complex `updated_objects` structures.

---

## Phase 3: Process Mining v1 (Object-Centric Petri Nets)

### Goal

Deliver the first end-to-end process mining capability using `pm4py` with Arrow-backed ClickHouse data extraction.

### Scope

Data extraction:
1. Implement programmatic SQL extractors for mining datasets.
2. Return Arrow-backed dataframes for analysis pipeline.
3. Add object-centric projection transforms required by chosen `pm4py` flows.

Mining service:
4. Implement object-centric Petri net generation service.
5. Implement process-map serialization for UI rendering.
6. Add baseline path frequency and dwell indicators.

UI:
7. Ship process explorer with process-map and timeline drill-down.
8. Connect object filters and time windows to mining runs.

### Exit Criteria

1. User can run object-centric Petri net generation from UI.
2. Returned process model reflects selected object type and time window.
3. Process explorer can navigate from map node/edge to supporting event traces.
4. Mining run outputs are reproducible for same filters and dataset snapshot.

### Dependencies

1. Phase 2 data model and ingestion outputs.
2. `pm4py` integration and validation sample datasets.

### Key Risks

1. Performance issues on large unbounded windows.
2. Data-shape mismatch between ClickHouse extracts and `pm4py` expectations.

### Mitigations

1. Require explicit analysis anchors (object type, time window).
2. Add run-time caps and clear user feedback when filters are too broad.

---

## Phase 4: Root Cause Analysis v1

### Goal

Deliver a practical root-cause flow for recursive attribute lifting and ranked subgroup insights.

### Scope

Extraction layer:
1. Implement pluggable neighborhood extraction interface.
2. Build iterative SQL extraction backend as default implementation.
3. Add optional recursive SQL implementation path (non-default).
4. Output lifted feature table keyed by seed object instance.

Ranking layer:
5. Implement WRAcc scoring for subgroup discovery.
6. Implement beam-style subgroup expansion.
7. Implement mutual information ranking for high-cardinality features.

Insight contract:
8. Implement `InsightResult` contract generation.
9. Attach evidence payloads (trace samples, aggregated support stats).

UI + AI:
10. Ship root cause lab configuration and results views.
11. Add AI guidance for hypothesis setup and result interpretation.

### Exit Criteria

1. User can define outcome per run from UI/AI workflow.
2. RCA run supports bounded traversal depth.
3. Top-ranked insights include score, coverage, delta, and evidence.
4. User can drill from insight to supporting traces.

### Dependencies

1. Phases 2 and 3 complete.
2. Stable process explorer drill-down APIs.

### Key Risks

1. Search-space explosion with deep traversal and many attributes.
2. Spurious correlations surfaced as top findings.

### Mitigations

1. Bound traversal depth and candidate limits in MVP.
2. Require coverage thresholds and evidence views in results.

---

## Phase 5: AI Layer Expansion + MVP Hardening

### Goal

Unify module-level AI experiences and stabilize MVP for external-facing pilot usage.

### Scope

AI integration:
1. Expand module-specific copilots beyond ontology.
2. Add guided investigation flow across ontology -> process -> RCA.
3. Add distinction between informational answers and analytical-claim responses.

Hardening:
4. Resolve high-severity defects from end-to-end testing.
5. Improve UX clarity for long-running analysis actions.
6. Add smoke/regression test coverage for all MVP module flows.

### Exit Criteria

1. End-to-end investigation flow works without manual backend intervention.
2. AI responses are contextually relevant in all MVP modules.
3. Critical bugs are resolved and release checklist passes.

### Dependencies

1. All prior phases functionally complete.

### Key Risks

1. UX fragmentation across module copilots.
2. Overly verbose or under-evidenced AI responses for analytical workflows.

### Mitigations

1. Standardize module interaction patterns.
2. Enforce analytical-claim response policy.

---

## 7. Cross-Phase Acceptance Gates

These gates are binary pass/fail and replace metric-heavy success criteria for MVP execution.

## Gate A: Data Contract Integrity

Must pass before Phase 3:
1. Event UUID validation and dedupe pass.
2. Object history UUID linkage correctness pass.
3. Object ref normalization consistency pass.

## Gate B: Ontology Integrity

Must pass before Phase 2 and remain green:
1. SHACL validation pass for known-good ontology fixtures.
2. SHACL failure diagnostics pass for known-invalid fixtures.
3. Deterministic named-graph upsert pass.

## Gate C: Process Mining Operability

Must pass before Phase 4:
1. Object-centric Petri net generation pass on representative dataset.
2. UI drill-down from map to traces pass.

## Gate D: RCA Interpretability

Must pass before Phase 5:
1. RCA output includes ranked hypotheses and evidence.
2. Insight drill-down to source traces pass.

## Gate E: Release Readiness

Must pass before MVP pilot:
1. End-to-end smoke tests pass.
2. No P0/P1 unresolved defects.
3. Critical workflows documented.

---

## 8. MVP Release Checklist

1. Ontology ingestion + SHACL validation working in production-like environment.
2. Ontology copilot usable with read-only SPARQL tools.
3. Event/object/link history persistence verified with UUID identities.
4. Object-centric Petri net process exploration available in UI.
5. RCA workflow available with user-driven outcomes and evidence-backed ranked output.
6. AI workflows available in ontology, process, and RCA modules.
7. Monorepo build/run docs and environment setup finalized.

---

## 9. Immediate Execution Priorities

1. Lock monorepo structure and local runtime startup.
2. Implement ontology ingestion + SHACL + URI-identity upsert.
3. Implement core ClickHouse schemas and ingestion writes.
4. Implement object-ref normalization helpers and tests.
5. Ship ontology copilot as first AI workflow.

---

## 10. Change Control for MVP Roadmap

To keep roadmap clarity:
1. Any scope addition must state phase impact and gate impact.
2. Any deferment must state risk and mitigation.
3. Major changes require updates to this file and parent vision file references.
