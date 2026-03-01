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
4. Description: Dedicated sweeper/maintenance runtime for proactive lease-expiry reconciliation (including singleton ownership via advisory lock) was deferred; current behavior relies on claim-time lease-expiry reclaim.
5. Impact: Expired leased actions are still recovered when claim traffic continues, but proactive reconciliation/metrics surfaces are incomplete without dedicated maintenance runtime.
6. Owner: `ORCH-ACT-1`
7. Proposed Fix: Implement a dedicated sweeper process that periodically transitions expired leased/running actions and emits explicit reconciliation telemetry.
8. Target Window: `Next post-MVP reliability hardening cycle`
9. Status: `open`
