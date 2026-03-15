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

1. ID: `TD-2026-03-07-003`
2. Date Added: `2026-03-07`
3. Area: `Assistant canvas`
4. Description: Compact/mobile assistant canvas states still use the generic artifact fallback, and non-OCDFG artifact families do not yet have specialized renderers.
5. Impact: Desktop `/assistant` now renders real OC-DFG visuals, but compact/mobile graph inspection and richer artifact-specific canvas treatments remain less informative.
6. Owner: `AI-ASSISTANT-1`
7. Proposed Fix: Add compact/mobile OC-DFG treatment and dedicated assistant canvas renderers for remaining artifact families when the `/assistant` experience is next hardened.
8. Target Window: `Next /assistant experience hardening cycle`
9. Status: `open`

1. ID: `TD-2026-03-15-004`
2. Date Added: `2026-03-15`
3. Area: `Managed-agent transcript persistence`
4. Description: The public/runtime contract now uses `action_uri`, but the internal ClickHouse transcript storage schema and repository adapter still use the historical column name `workflow_uri`.
5. Impact: Product/API terminology is correct, but broad stale-concept grep still surfaces the storage column and repository mapping as an intentional residual.
6. Owner: `AGENT-ACTION-MODEL-1`
7. Proposed Fix: Run a focused persistence cleanup to rename the transcript column and repository SQL wiring to `action_uri`, including the required migration/backfill strategy for existing environments.
8. Target Window: `Next managed-agent persistence hardening cycle`
9. Status: `open`
