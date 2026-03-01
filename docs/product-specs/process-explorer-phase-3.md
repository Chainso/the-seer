# Process Explorer Phase 3 Spec

**Status:** completed  
**Owner phase:** `docs/exec-plans/completed/ocdfg-pm4py-backend-ui-first-diagram.md`  
**Last updated:** 2026-03-01

---

## Purpose

Define user-facing behavior for OC-DFG-first process mining and trace drill-down in Inspector Insights.

## Primary User Flow

1. User opens `/inspector/insights` and selects `Process Mining`.
2. User enters:
   - `anchor_object_type`,
   - `start_at`,
   - `end_at`.
3. User runs mining request.
4. UI requests `POST /api/v1/process/ocdfg/mine` and renders OC-DFG first:
   - `nodes`,
   - `edges`,
   - `start_activities`,
   - `end_activities`,
   - `object_types`,
   - optional edge performance percentiles (`p50_seconds`, `p95_seconds`).
5. UI keeps secondary diagrams available:
   - `POST /api/v1/process/mine` for OCPN,
   - derived BPMN path from collapsed OCPN.
6. User clicks a node, edge, start activity, or end activity entry.
7. UI requests trace drill-down with the backend handle and renders matching traces.

## Backend Contracts Consumed by UI

1. `POST /api/v1/process/ocdfg/mine` (primary mining run)
2. `POST /api/v1/process/mine` (secondary OCPN path)
3. `GET /api/v1/process/traces` (shared drill-down for OC-DFG and OCPN handles)

## Acceptance Expectations

1. OC-DFG run request enforces required anchor and valid time window.
2. OC-DFG response includes trace handles for `nodes`, `edges`, `start_activities`, and `end_activities`.
3. OC-DFG mining is `pm4py`-backed; missing runtime surfaces actionable dependency errors (503) instead of silent fallback.
4. Shared drill-down returns trace lists keyed by selected OC-DFG or OCPN model element.
5. Empty/oversized/invalid requests produce actionable error messages surfaced in UI.
6. Re-running against unchanged data snapshot produces deterministic ordering for OC-DFG payload arrays.

## Out of Scope (Phase 3)

1. Conformance checking and simulation.
2. Large-dataset tuning beyond configured guardrails.
3. Non-object-centric mining methods.
