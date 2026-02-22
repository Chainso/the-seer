# MVP Phase 2 Exec Plan: Event Ingestion and History Data Model

**Status:** completed  
**Target order:** 2 of 6  
**Agent slot:** A3  
**Predecessor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-1-ontology-copilot-v1.md`  
**Successor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/active/mvp-phase-3-process-mining-ocpn.md`
**Last updated:** 2026-02-22

---

## Objective

Implement immutable historical ingestion in ClickHouse using the three-table MVP model with UUID identities and normalized object references.

## Scope

1. Define and apply schemas for `event_history`, `object_history`, `event_object_links`.
2. Build ingestion endpoint for event payloads.
3. Validate required fields and UUID formats.
4. Persist event rows, object snapshot rows, and event-object link rows.
5. Implement object reference canonicalization and hash generation.
6. Add baseline query endpoints for event/object timeline retrieval.

## Non-Goals

1. Derived analytics tables.
2. Multi-tenant partitioning model.
3. Replay/dead-letter reliability subsystems.

## Ambiguities Resolved

1. **ClickHouse table engines:** use `MergeTree` for all three core tables in MVP.
2. **Primary ordering keys:**
   - `event_history`: `ORDER BY (occurred_at, event_id)`
   - `object_history`: `ORDER BY (object_type, object_ref_hash, recorded_at, object_history_id)`
   - `event_object_links`: `ORDER BY (event_id, object_type, object_ref_hash, object_history_id)`
3. **Duplicate event behavior:** duplicate `event_id` is rejected with conflict response; no second write.
4. **`updated_objects` behavior:** if absent, event is still ingested; object/link inserts are skipped.
5. **Canonicalization algorithm:** deterministic JSON serialization with recursive key sorting, stable primitive formatting, UTF-8 output.
6. **Hash algorithm:** `xxhash64(object_ref_canonical)` stored as `UInt64`.
7. **Join truth rule:** attributes-at-event-time joins must use `object_history_id`; object identity traversal uses `(object_type, object_ref_hash)` with canonical verification when needed.

## Implementation Steps

1. Implement ClickHouse migration scripts for all three tables.
2. Implement ingestion API contract and validation pipeline.
3. Implement write path:
   - `event_history` append,
   - `object_history` snapshot append,
   - `event_object_links` append with object_type consistency enforcement.
4. Implement object reference normalization utilities and tests.
5. Implement query APIs:
   - event timeline by time window/type,
   - object timeline by object type/hash,
   - event-object relation fetch by event or object anchor.
6. Add fixture-based integration tests for:
   - composite object refs,
   - missing `updated_objects`,
   - duplicate `event_id`,
   - object_type mismatch rejection.

## Acceptance Criteria

1. `event_id` and `object_history_id` are UUIDs in persisted records.
2. Ingestion writes immutable history records into all applicable tables.
3. `event_object_links` rows reference concrete `object_history_id` values.
4. `event_object_links.object_type` equals referenced `object_history.object_type`.
5. Default user-facing timeline semantics use `occurred_at`.
6. Canonicalization and hash output are deterministic across repeated runs.

## Handoff Package to Phase 3

1. Final table DDL and migration scripts.
2. Ingestion API examples and validation error catalog.
3. Query API examples returning event/object/link datasets.
4. Canonicalization spec with tested fixture vectors.
5. Sample seeded dataset suitable for process mining bootstrap.

## Risks and Mitigations

1. **Risk:** canonicalization bugs create split identities.  
   **Mitigation:** golden fixtures for composite refs and deterministic hash tests.
2. **Risk:** malformed payload variance across producers.  
   **Mitigation:** strict schema validation with clear rejection diagnostics.

## Completion Summary

1. Implemented ClickHouse migration `001_mvp_phase2_history_tables.sql` for:
   - `event_history`,
   - `object_history`,
   - `event_object_links`,
   using `MergeTree` and the planned ordering keys.
2. Implemented history ingestion API `POST /api/v1/history/events/ingest` with strict payload validation and duplicate `event_id` conflict handling.
3. Implemented deterministic object-reference canonicalization + `xxhash64` hash derivation for object identity joins.
4. Implemented three-table write flow:
   - immutable `event_history` append,
   - immutable `object_history` snapshot append,
   - `event_object_links` append anchored to concrete `object_history_id`.
5. Implemented baseline query APIs:
   - `GET /api/v1/history/events`,
   - `GET /api/v1/history/objects/timeline`,
   - `GET /api/v1/history/relations`.
6. Added Phase 2 test coverage for:
   - canonicalization/hash determinism,
   - composite object refs,
   - missing `updated_objects`,
   - duplicate event conflict,
   - UUID validation rejection,
   - object type mismatch rejection,
   - occurred-at timeline ordering.

## Decision Log

1. History schema migrations are applied lazily on first history-service usage via repository `ensure_schema`.
2. `updated_objects` remains optional and does not block event ingestion.
3. Link/object `object_type` consistency is enforced in validation and in-memory repository checks; service write-path keeps both values in lock-step.
4. Query default ordering semantics are based on `occurred_at` (not ingestion time) for user-facing timeline behavior.

## Acceptance Evidence

1. `cd seer-backend && uv run ruff check src/seer_backend/history src/seer_backend/api/history.py tests/test_history_phase2.py`  
   Result: `All checks passed!`
2. `cd seer-backend && uv run pytest tests/test_history_phase2.py -q`  
   Result: `7 passed`.
3. `cd seer-backend && uv run pytest -q`  
   Result: `19 passed` (all backend tests in this workspace state).
4. User-provided execution context confirms all tests passed as of 2026-02-22; this aligns with the full-suite run above.

## Doc Updates

1. Moved this plan from `docs/exec-plans/active/` to `docs/exec-plans/completed/`.
2. Updated execution index and roadmap references so Phase 3 is the active in-progress phase.
3. Updated completed-plan index to include this phase completion record.

## Known Issues

1. FastAPI startup event uses deprecated `on_event("startup")`; warnings remain non-blocking and are tracked outside Phase 2 scope.

## Next-Phase Starter Context

1. History API and service entry points:
   - `seer-backend/src/seer_backend/api/history.py`
   - `seer-backend/src/seer_backend/history/service.py`
2. Storage contract and migration:
   - `seer-backend/migrations/clickhouse/001_mvp_phase2_history_tables.sql`
   - `seer-backend/src/seer_backend/history/repository.py`
3. Canonicalization/hash contract:
   - `seer-backend/src/seer_backend/history/canonicalization.py`
4. Phase 2 fixtures/tests for process-mining bootstrap reference:
   - `seer-backend/tests/test_history_phase2.py`
