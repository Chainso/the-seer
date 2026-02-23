# UI Experience Replatform Phase F Verification Harness

**Status:** active  
**Last updated:** 2026-02-22

---

## Decision

Use a zero-dependency Node test harness inside `seer-ui/tests` for Phase F hardening coverage.

## Context

1. Phase F ownership allows changes under `seer-ui/tests/**` and `seer-ui/package.json` scripts.
2. Replatformed UI code depends on TypeScript, TSX, `@/*` path aliases, and CSS modules.
3. A harness was needed without adding new package dependencies.

## Harness Design

1. Test runner: Node built-in test runner (`node --test`).
2. Loader: `seer-ui/tests/node-test-loader.mjs` transpiles `.ts/.tsx` via `typescript.transpileModule`.
3. Alias support: loader resolves `@/*` to `seer-ui/src/*`.
4. CSS imports: loader stubs CSS modules as empty exports for non-browser test execution.

## Test Suite Layout

1. `seer-ui/tests/adapters/*`: adapter behavior and transformation stability.
2. `seer-ui/tests/flows/*`: guided investigation shortcut and handoff flow integrity.
3. `seer-ui/tests/rendering/*`: rendering hardening for shared UI primitives.

## Why This Approach

1. Keeps Phase F verification self-contained and within ownership boundaries.
2. Avoids introducing new runtime/testing dependencies late in rollout.
3. Exercises critical transformation and rendering logic with deterministic local execution.

## Maintenance Notes

1. Keep tests focused on deterministic outputs and failure modes.
2. Add new adapter and flow tests when module contracts evolve.
3. If a future phase introduces broader ownership, the harness can migrate to a full framework runner.
