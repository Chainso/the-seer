# Process Explorer Phase 3 Spec

**Status:** completed  
**Owner phase:** `docs/exec-plans/completed/mvp-phase-3-process-mining-ocpn.md`  
**Last updated:** 2026-02-22

---

## Purpose

Define user-facing behavior for MVP Process Explorer object-centric mining and trace drill-down.

## Primary User Flow

1. User opens `/process`.
2. User enters:
   - `anchor_object_type`,
   - `start_at`,
   - `end_at`.
3. User runs mining request.
4. UI renders:
   - `nodes`,
   - `edges`,
   - `object_types`,
   - `path_stats`.
5. User clicks a node, edge, or path entry.
6. UI requests trace drill-down with the backend handle and renders matching traces.

## Backend Contracts Consumed by UI

1. `POST /api/v1/process/mine`
2. `GET /api/v1/process/traces`

## Acceptance Expectations

1. Run request enforces required anchor and valid time window.
2. Mining responses include trace handles for all node/edge/path entries.
3. Drill-down returns trace lists keyed by selected model element.
4. Empty/oversized/invalid requests produce actionable error messages surfaced in UI.
5. Re-running against unchanged data snapshot produces deterministic model payload ordering.

## Out of Scope (Phase 3)

1. Conformance checking and simulation.
2. Large-dataset tuning beyond configured guardrails.
3. Non-object-centric mining methods.
