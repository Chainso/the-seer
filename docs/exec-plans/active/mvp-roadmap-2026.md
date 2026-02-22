# Seer MVP Roadmap and Execution Plan

**Status:** Canonical MVP umbrella roadmap  
**Date:** 2026-02-22  
**Parent strategy:** `/home/chanzo/code/large-projects/seer-python/VISION.md`  
**Phase index:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/active/index.md`

---

## 1. Purpose

This file defines the MVP roadmap at umbrella level:

1. the target outcome,
2. what is out of scope,
3. phase ordering,
4. cross-phase gates,
5. release decision criteria.

Detailed execution lives in phase files under `docs/exec-plans/active/` and `docs/exec-plans/completed/`.

## 2. MVP Outcome

MVP is complete when Seer can:

1. Ingest Prophet local ontology Turtle files.
2. Validate ontology against Prophet base metamodel using SHACL.
3. Upsert ontology definitions into Fuseki using deterministic URI-based behavior.
4. Provide read-only ontology exploration and ontology copilot Q&A.
5. Ingest events with UUID `event_id` and append immutable event history.
6. Persist object snapshots with UUID `object_history_id`.
7. Persist event-object links from event UUIDs to specific object history UUIDs with normalized refs.
8. Run object-centric Petri net analysis via `pm4py` over Arrow-backed ClickHouse extracts.
9. Run RCA with user-defined outcomes and evidence-backed ranked hypotheses.
10. Deliver AI-assisted process and RCA workflows usable end-to-end.

## 3. MVP Non-Goals

1. Ontology authoring in Seer UI.
2. Multi-tenant data-layer architecture.
3. Heavy reliability subsystems (replay, dead-letter orchestration, schema/version governance).
4. Governance/trust-center feature modules.
5. Mining-method breadth beyond object-centric Petri nets.

## 4. Phase Sequencing (Authoritative Files)

Execution is strictly sequential and each phase is owned by a different agent slot.

1. Phase 0: Foundation and Skeleton  
   `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-0-foundation-skeleton.md`
2. Phase 1: Ontology Ingestion and Copilot v1  
   `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-1-ontology-copilot-v1.md`
3. Phase 2: Event Ingestion and History Data Model  
   `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-2-event-history-ingestion.md`
4. Phase 3: Process Mining v1 (Object-Centric Petri Nets)  
   `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-3-process-mining-ocpn.md`
5. Phase 4: Root Cause Analysis v1  
   `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-4-root-cause-analysis-v1.md`
6. Phase 5: AI Expansion, Hardening, and MVP Release  
   `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-5-ai-hardening-release.md`

## 5. Cross-Phase Acceptance Gates

These are pass/fail and apply across phase boundaries.

### Gate A: Ontology Integrity

Must pass before Phase 2 starts:

1. SHACL pass on known-good fixtures.
2. SHACL fail diagnostics on known-bad fixtures.
3. Deterministic named-graph upsert behavior.

### Gate B: Data Contract Integrity

Must pass before Phase 3 starts:

1. UUID and dedupe behavior for events.
2. Object history UUID linkage correctness.
3. Deterministic object-ref canonicalization/hash behavior.

### Gate C: Process Mining Operability

Must pass before Phase 4 starts:

1. Object-centric Petri net generation passes on representative fixtures.
2. Process explorer drill-down from model to traces works end-to-end.

### Gate D: RCA Interpretability

Must pass before Phase 5 starts:

1. RCA returns ranked hypotheses with score, coverage, and evidence.
2. RCA insight drill-down to source traces works.

### Gate E: Release Readiness

Must pass before MVP pilot release:

1. End-to-end smoke tests pass.
2. No unresolved P0/P1 defects.
3. Critical workflows and operating docs are updated.

## 6. Immediate Execution Order

1. Phases 0, 1, 2, 3, 4, and 5 are complete.
2. MVP release gate decision: **pass** (2026-02-22).
3. Preserve this roadmap as completed execution history and use new plans for post-MVP work only.

Phase 1 execution pivot (2026-02-22):
1. Ontology Copilot v1 model execution uses backend Gemini CLI headless invocation (`gemini -p ...`) with structured output parsing.
2. The detailed command contract, schema expectations, and safeguards are tracked in `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-1-ontology-copilot-v1.md`.

## 7. Change Control

1. Any scope addition must state impacted phase file(s) and gate impact.
2. Any deferment must state risk and mitigation in the relevant phase plan.
3. Any architecture or invariant change must update `VISION.md` and `ARCHITECTURE.md` alongside phase-plan changes.
4. When a phase is complete, update status and move historical artifacts per `docs/exec-plans/README.md` workflow.
