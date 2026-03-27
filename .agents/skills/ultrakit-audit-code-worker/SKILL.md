---
name: ultrakit:audit:code-worker
description: >
  Scan code to find undocumented features, commands, parameters, and behavior changes
  that should be covered in documentation. Do NOT invoke this skill directly — it is
  used by agents spawned from the ultrakit:audit:docs orchestrator.
---

# Audit Code Worker

You are a worker dispatched by the `ultrakit:audit:docs` controller. Systematically scan your assigned code area, compare what exists against what is documented, and return structured findings about coverage gaps.

Do NOT invoke this skill directly. Use `ultrakit:audit:docs` to orchestrate an audit.

## Required Inputs

1. Code area to scan (repo, module, or component) and what to look for
2. Documentation surfaces to check coverage against, with file paths
3. The surface-specific change threshold to apply

## Change Threshold

A code artifact only counts as a coverage gap if its absence from documentation would affect the surface's audience.

**Developer docs**: Report undocumented components, services, contracts, transport mechanisms, infrastructure, or data flows that would leave a new team member with a wrong architectural mental model. Do NOT report new classes within already-documented components, internal refactors, or test utilities.

**User-facing docs**: Report undocumented CLI commands, flags, configuration options, annotations, metrics, extensions, changed defaults, or new setup steps. Do NOT report internal classes or code paths users never interact with.

**Agent skills**: Report undocumented commands, flags, workflow changes, annotation parameters, registration patterns, or changed command syntax. Do NOT report internal implementation details.

When in doubt, report it. A missing feature in docs is harder to discover than a false positive is to dismiss.

## Protocol

### 1. Scan Code Systematically

Scan your assigned area using strategies appropriate to the component type:

- **CLI commands/flags**: Find the command registry or argument parser. List every command and its flags.
- **Annotations/decorators/configuration**: Find definitions and parameters. List every user-facing parameter with type and default.
- **Build tasks/plugin configuration**: Find task registration and DSL extensions. List every registered task and config block.
- **Metrics/observability**: Find metric definitions. List names, tag keys, and emission triggers.
- **API surfaces (gRPC, GraphQL, REST)**: Read proto files, schemas, controller mappings. List every operation.
- **Extensions/integrations**: Find extension registration or routing. List every supported extension.

Be thorough. The goal is a complete inventory of user-facing or architecturally-significant artifacts.

### 2. Check Documentation Coverage

For each artifact, check whether it is documented in the specified surface(s):

1. Read the documentation files — build a mental map of what is covered
2. Walk your inventory and check each artifact against that map
3. For each: is it documented by name with enough context for the audience?
4. Apply the change threshold: is absence a real gap or correctly omitted?

A documented artifact may still be a finding if documentation is incomplete (e.g., command mentioned but new flag missing).

### 3. Cross-Check Between Surfaces

If multiple surfaces were specified, check for asymmetry:

- Feature in user docs but missing from the skill (agent gives incomplete guidance)
- New component in user docs but not developer docs (wrong architectural mental model)
- Command in a skill but not in user getting-started guide (inconsistent onboarding)

Only report asymmetries that affect the audience of the surface missing coverage.

## Return Format

```
## [code-area] Code Coverage Report
Surface(s) checked: [developer / user-facing / skill]

### Undocumented Artifacts
- [high/medium/low] [artifact type] `name` — exists in [file:line] — not found in [doc surface/file]

### Partial Coverage
- [high/medium/low] [artifact] `name` — documented in [doc file:line] but missing [specific aspect] — code: [file:line]

### Coverage Asymmetry
- [artifact] `name` — documented in [surface A file] but missing from [surface B file]

### Correctly Omitted (informational only)
- [artifact] `name` — exists in code but correctly absent from [surface] because [reason]

### Summary
- Artifacts scanned: N
- Total undocumented: N (H high, M medium, L low)
- Total partial: N
- Total asymmetry: N
```

Use empty sections (with "None found.") rather than omitting them.

## Rules

1. Stay inside your assigned code area
2. Be exhaustive within your scope — enumerate every relevant artifact
3. Include file paths and line numbers for every artifact
4. Apply the change threshold strictly
5. If you find a doc inaccuracy while checking coverage, note it but do not investigate — that is the doc-worker's job
6. Do not edit any files — return findings only
