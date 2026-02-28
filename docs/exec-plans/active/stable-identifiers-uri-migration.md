# Post-MVP Exec Plan: Stable URI Identifiers for Event/Process/RCA Contracts

**Status:** in_progress  
**Target order:** post-MVP track 3  
**Agent slot:** DATA-RCA-1  
**Predecessor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/active/post-mvp-ontology-process-readonly-adaptation.md`  
**Successor:** TBD  
**Last updated:** 2026-02-28

---

## Objective

Adopt stable ontology concept identifiers (URI-based) for API inputs and persisted event semantics, so display-name edits do not break ingestion, process mining, or RCA behavior.

Primary requirement:

1. Event ingestion `event_type` and `updated_objects.object_type` semantics must be stable and non-display-derived.

Secondary requirement:

1. Process mining and RCA contracts must use the same stable identifiers end-to-end.

## Problem Summary (Current State)

Current contracts and adapters are string-based and rely on mutable naming conventions:

1. History ingest accepts arbitrary `event_type` and `object_type` strings (length-only validation).
2. RCA outcome matching uses exact string equality on `event_type`.
3. Process mining and RCA anchor object types are caller-provided strings.
4. UI adapters currently derive these strings from ontology labels by stripping spaces and converting casing.
5. Fake-data generation and RCA verification scripts use human-readable/mutable names.

This creates drift risk when ontology labels are edited for UX wording.

## Source Findings (Scoped)

### Backend contracts currently string-typed (non-URI-enforced)

1. History ingestion request:
   - `event_type: str`
   - `updated_objects[].object_type: str`
   - File: `/home/chanzo/code/large-projects/seer-python/seer-backend/src/seer_backend/history/models.py`
2. RCA request:
   - `outcome.event_type: str`
   - `outcome.object_type: str | None`
   - `anchor_object_type: str`
   - File: `/home/chanzo/code/large-projects/seer-python/seer-backend/src/seer_backend/analytics/rca_models.py`
3. Process mining request:
   - `anchor_object_type: str`
   - `include_object_types: list[str] | None`
   - File: `/home/chanzo/code/large-projects/seer-python/seer-backend/src/seer_backend/analytics/models.py`

### Backend matching/query behavior is exact string equality

1. RCA outcome evaluation compares `event.event_type != outcome.event_type`.
   - File: `/home/chanzo/code/large-projects/seer-python/seer-backend/src/seer_backend/analytics/rca_service.py`
2. History query filtering uses `event_type = <literal>`.
   - File: `/home/chanzo/code/large-projects/seer-python/seer-backend/src/seer_backend/history/repository.py`

### Frontend adapters currently derive unstable identifiers from display labels

1. Process mining adapter converts ontology concept label to `anchor_object_type` by removing spaces.
   - File: `/home/chanzo/code/large-projects/seer-python/seer-ui/app/lib/api/process-mining.ts`
2. Root-cause panel derives anchor object type and event type values from labels / local names.
   - File: `/home/chanzo/code/large-projects/seer-python/seer-ui/app/components/inspector/process-insights-panel.tsx`
3. Ontology display catalog canonicalizes event identifiers from `prophet:name` by stripping spaces.
   - File: `/home/chanzo/code/large-projects/seer-python/seer-ui/app/lib/ontology-display/catalog.ts`

### Test and script fixtures encode mutable identifiers

1. Fake generator emits display-like event names.
   - File: `/home/chanzo/code/large-projects/seer-python/scripts/generate_fake_event_data.py`
2. RCA verification script hardcodes non-URI anchor/outcome strings.
   - File: `/home/chanzo/code/large-projects/seer-python/scripts/verify_fake_data_rca.py`

## Canonical Identifier Decision

Canonical semantic identifiers for event/object references in history/process/RCA payloads will be ontology concept URIs.

Examples:

1. Event type: `http://prophet.platform/local/artisan_bakery_local#aout_create_sales_order`
2. Object type: `http://prophet.platform/local/artisan_bakery_local#obj_sales_order`

Display labels remain UI concern only.

## Migration Plan

## Phase 1: Contract Compatibility Layer (Backend First)

Goal: introduce URI-aware inputs without breaking existing clients.

Deliverables:

1. Extend request contracts with URI-first fields while keeping legacy fields for compatibility:
   - History ingest: `event_type_uri`, `updated_objects[].object_type_uri`
   - RCA: `anchor_object_type_uri`, `outcome.event_type_uri`, `outcome.object_type_uri`
   - Process: `anchor_object_type_uri`, `include_object_type_uris`
2. Add normalization in services:
   - If URI field present, use URI as canonical identifier.
   - Else use legacy string path as fallback (temporary).
3. Persist canonical identifier into existing storage columns (`event_type`, `object_type`) for now to avoid immediate schema churn.
4. Add compatibility warnings in responses/logs when legacy non-URI fields are used.

Exit criteria:

1. Existing clients keep working.
2. New clients can pass URIs and get deterministic matching.

## Phase 2: Frontend Adapter Migration to URI Inputs

Goal: remove label-derived ID construction from UI clients.

Deliverables:

1. Update process mining client to submit model URI directly (no label-to-token conversion).
2. Update root-cause panel to:
   - send anchor object URI,
   - send outcome event URI,
   - stop constructing event/object identifiers from display names.
3. Update ontology display/index helpers so event lookup keys are URI-based first; keep legacy token aliases only for fallback rendering.

Exit criteria:

1. Inspector process + RCA flows operate with URI payloads only.
2. Display label edits do not alter payload identifiers.

## Phase 3: Data Generation, Fixtures, and Tests

Goal: make local tooling and test data URI-stable.

Deliverables:

1. Update fake event generator to emit URI `event_type` and URI `updated_objects.object_type`.
2. Update RCA verification script/test fixtures to use URI identifiers.
3. Refresh contract/unit tests across history/process/RCA for URI-first behavior and legacy fallback coverage.

Exit criteria:

1. Fake-data workflow and RCA checks pass with URI identifiers.
2. CI covers URI and fallback behavior.

## Phase 4: Strict Mode and Legacy Deprecation

Goal: enforce stable IDs by default.

Deliverables:

1. Add strict validation mode to reject non-URI event/object identifiers.
2. Deprecate and remove legacy non-URI fields after migration window.
3. Provide migration notes and, if needed, one-time data remap tooling for old datasets.

Exit criteria:

1. Production-default contracts are URI-stable.
2. Name/display edits cannot change event/object identity semantics.

## Risks and Mitigations

1. Mixed datasets (legacy names + URIs) can fragment RCA outcomes.
   - Mitigation: compatibility normalization + migration backfill guidance.
2. URI string length may exceed current field caps in edge ontologies.
   - Mitigation: evaluate and expand max-length constraints where required.
3. Feature keys in RCA currently embed identifiers in dotted strings.
   - Mitigation: add escaping/encoding strategy where keys include URI punctuation.

## Acceptance Criteria

1. History ingestion accepts and persists URI event/object identifiers as canonical values.
2. RCA and process mining requests are URI-driven and stable under ontology label edits.
3. UI no longer derives semantic IDs from display labels.
4. Fake-data and automated verification use URI identifiers.

## Progress Notes

### 2026-02-28 - Phase 1 backend compatibility slice (history/process/RCA)

Status: completed for backend Phase 1 scope.

Implemented:

1. Added additive URI-first compatibility request fields (legacy fields retained):
   - History ingest: `event_type_uri`, `updated_objects[].object_type_uri`
   - Process mining: `anchor_object_type_uri`, `include_object_type_uris`
   - RCA: `anchor_object_type_uri`, `outcome.event_type_uri`, `outcome.object_type_uri`
2. Added canonicalization accessors in backend contracts and switched downstream usage to canonical values:
   - Ingest persistence writes canonical event/object identifiers into existing `event_type`/`object_type` columns.
   - Process mining extraction filters (ClickHouse + in-memory) use canonical anchor/include identifiers.
   - RCA extraction anchor filters (ClickHouse + in-memory) use canonical anchor identifier.
   - RCA outcome matching uses canonical outcome event/object identifiers.
3. Preserved API routes and response shapes; no schema migration introduced.

Decisions recorded:

1. Canonical semantics are resolved at contract layer via URI-first accessors (`*_uri` if present, else legacy field).
2. Existing storage columns remain source of truth for canonical values during Phase 1 (no dual-write schema change).
3. Trace/evidence flows continue to use existing payload shapes, but with canonicalized values propagated through context.

### 2026-02-28 - Phase 2 frontend URI-first migration (process + RCA panel)

Status: completed for scoped Phase 2 changes.

Implemented:

1. Migrated process mining API adapter to URI-first request fields:
   - Sends `anchor_object_type_uri` and `include_object_type_uris`.
   - Retains `anchor_object_type` and `include_object_types` as compatibility fallbacks derived from URI local names.
   - Removed ontology concept label fetch for anchor derivation to avoid mutable-label dependency.
2. Migrated inspector root-cause flow to URI-first semantics:
   - Outcome selector now uses event concept URI as option value.
   - RCA run payload sends `anchor_object_type_uri`, `outcome.event_type_uri`, and `outcome.object_type_uri`.
   - Legacy fallback fields remain populated from URI-local-name derivation (no display-label dependency).
3. Added additive backend setup compatibility for anchor URI:
   - `RootCauseAssistSetupRequest` now supports optional `anchor_object_type_uri` and canonical accessor.
   - Setup preview request propagation includes `anchor_object_type_uri` so extraction respects URI canonicalization.

Scope exclusions honored:

1. No Phase 3 fake-data/fixture/test-migration work included.

### 2026-02-28 - Phase 3 URI-stable fake-data tooling + RCA verification

Status: completed for scoped Phase 3 changes.

Implemented:

1. Migrated fake-data generator identifier semantics to ontology URIs sourced from generated Turtle:
   - `scripts/generate_fake_event_data.py` now reads `prophet/examples/turtle/prophet_example_turtle_small_business/gen/turtle/ontology.ttl`.
   - Required event/object concept IDs are resolved to full URIs from ontology prefix + concept local IDs.
   - Generated events now emit URI values for `event_type`, `updated_objects[].object_type`, and embedded `updated_objects[].object.object_type`.
2. Migrated RCA fake-data verification tooling to URI anchors/outcomes:
   - `scripts/verify_fake_data_rca.py` scenarios now submit URI values for anchor and outcome identifiers (including URI-first request fields).
   - Verification ingestion path canonicalizes legacy fake-data token identifiers to ontology URIs for compatibility.
3. Migrated backend fake-data RCA regression test to URI flow:
   - `seer-backend/tests/test_root_cause_fake_data.py` now normalizes loaded fake events to URI event/object identifiers prior to ingest.
   - RCA requests use URI anchor/outcome identifiers and URI-first fields.

Decisions recorded:

1. Phase 3 resolves identifiers from ontology concept local IDs (`obj_*`, `aout_*`, `sig_*`, `trans_*`) instead of `prophet:name` display labels.
2. Compatibility handling remains in fake-data verification/test loaders to support legacy tokenized fixture inputs while validating URI-first RCA execution.
