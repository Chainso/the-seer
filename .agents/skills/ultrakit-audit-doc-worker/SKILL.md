---
name: ultrakit:audit:doc-worker
description: >
  Verify documentation against actual code and other documentation surfaces. Do NOT
  invoke this skill directly — it is used by agents spawned from the ultrakit:audit:docs
  orchestrator. If you need to audit documentation, use ultrakit:audit:docs instead.
---

# Audit Doc Worker

You are a worker dispatched by the `ultrakit:audit:docs` controller. Verify your assigned doc(s) and return structured findings.

Do NOT invoke this skill directly. Use `ultrakit:audit:docs` to orchestrate an audit.

## Required Inputs

1. Doc path(s) to verify and which surface they belong to (developer, user-facing, or skill)
2. Code repos and specific file paths to explore
3. Other documentation surfaces to cross-reference
4. Whether to assess structural fitness

If any input is missing, infer the smallest safe assumption and note it in your report.

## Change Threshold

Apply the threshold for the surface you are auditing.

**Developer docs**: Would a new team member get a wrong architectural mental model? Report shifted component boundaries, changed contracts, added/removed components, reversed design decisions, inaccurate diagrams. Do NOT report renamed classes, moved implementation files, internal refactors, or dependency bumps.

**User-facing docs**: Would a user have wrong expectations of how the product behaves? Report changed configuration options, broken getting-started workflows, incorrect expected behavior, undocumented features, broken code examples. Do NOT report internal implementation details, architecture changes invisible to users, or internal class names.

**Agent skills**: Would an agent give wrong guidance? Report changed CLI commands, updated workflows, modified patterns, incorrect configuration. Do NOT report internal implementation details that do not affect the guidance given.

When in doubt for developer docs, err on the side of NOT reporting. These docs should be stable. When in doubt for user-facing docs and skills, err on the side of reporting.

## Protocol

### 1. Read the Doc

Read assigned doc(s) fully. Identify which surface it belongs to. Note every claim relevant to that surface's audience.

### 2. Verify Against Code

Read curated files first (from the controller), then search broadly. Verify claims appropriate to the surface:

- **Developer docs**: Do components still exist and interact as documented? Are contracts accurate? Are data flows correct?
- **User-facing docs**: Do documented configurations work? Do workflows match reality? Do code examples compile?
- **Skills**: Do referenced commands exist? Do workflows match current code?

Be exhaustive. Read every relevant file. Do NOT guess — only report what you find in code.

### 3. Cross-Reference Other Surfaces

Read other documentation surfaces mapped by the controller. Do surfaces tell consistent stories at their respective levels of abstraction? Only flag inconsistencies where one surface gives its audience a wrong understanding, not where surfaces operate at different detail levels.

### 4. Validate Cross-References

Check every link in the doc. Do linked files and sections exist? Are anchors valid? Are there important related docs that should be linked?

### 5. Assess Structure (if requested)

Is the doc's scope appropriate? Does it overlap with another doc? Are major topics missing? Would the organization serve the reader well?

## Return Format

```
## [doc-name.md] Audit Report
Surface: [developer / user-facing / skill]

### Architectural Inaccuracies
- [high/medium/low] [description] — actual: [what code shows] — file: [path:line]

### Coverage Gaps
- [topic] — exists in [source] but missing from this doc

### Consistency Issues
- [topic] — this doc says [X], [other-surface doc] says [Y]

### Cross-Reference Issues
- [broken link] → [target missing/moved to X]
- [missing link] — [related doc/section] should be linked from [context]

### Structural Observations (if assessed)
- [observation about scope, organization, or fitness]

### Below Threshold (informational only)
- [description] — noted but does not affect this surface's audience

### Summary
- Total findings: N (H high, M medium, L low)
- Recommendation: [no changes needed / targeted fixes / significant update needed]
```

Use empty sections (with "None found.") rather than omitting them.

## Rules

1. Stay inside your assigned doc scope
2. Report only what you find in actual code — do not speculate
3. Include file paths and line numbers for every finding
4. Distinguish "definitely wrong" (high) from "possibly outdated" (medium/low)
5. Apply the change threshold for the correct surface
