# Technical Debt Tracker

## Purpose

Track known debt explicitly and prioritize cleanup without losing product momentum.

## Fields

- ID
- Date Added
- Area
- Description
- Impact
- Owner
- Proposed Fix
- Target Window
- Status

## Entries

1. ID: `TD-2026-03-01-001`
2. Date Added: `2026-03-01`
3. Area: `Action orchestration backend`
4. Description: Dedicated sweeper/maintenance runtime for proactive lease-expiry reconciliation (including singleton ownership via advisory lock).
5. Impact: Reliability hardening is complete; expired lease reconciliation no longer depends on claim traffic.
6. Owner: `ORCH-ACT-1`
7. Proposed Fix: Implement a dedicated sweeper process that periodically transitions expired leased/running actions and emits explicit reconciliation telemetry.
8. Target Window: `Next post-MVP reliability hardening cycle`
9. Status: `closed (2026-03-01)`

1. ID: `TD-2026-03-01-002`
2. Date Added: `2026-03-01`
3. Area: `Action orchestration backend`
4. Description: Deeper semantic payload validation (enum/domain/date strictness beyond current ontology-driven shape/cardinality/type checks) remains deferred.
5. Impact: Current validation enforces ontology shape/cardinality/basic type expectations, but richer semantic constraints are not yet enforced centrally.
6. Owner: `ORCH-ACT-1`
7. Proposed Fix: Extend submit-time validation with explicit enum/domain/date-format semantics derived from ontology contract metadata and canonical validators.
8. Target Window: `Future reliability + contract-hardening cycle`
9. Status: `open`
