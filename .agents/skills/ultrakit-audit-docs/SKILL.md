---
name: ultrakit:audit:docs
description: >
  Audit and improve project documentation by dispatching parallel agents to verify
  accuracy and find coverage gaps. Runs ad-hoc or on a schedule — separate from the
  engineering delivery workflow. Use after structural changes land, for periodic
  accuracy audits, or when documentation feels stale.
---

# Audit Docs

Orchestrate a documentation audit by dispatching parallel agents in two directions: `ultrakit:audit:doc-worker` agents verify docs against code (docs → code), and `ultrakit:audit:code-worker` agents scan code for undocumented features (code → docs). Then dispatch `ultrakit:audit:doc-fixer` agents to apply changes.

This skill is separate from the engineering delivery workflow. It runs ad-hoc or on a schedule to keep documentation current.

## Documentation Surfaces

Projects typically have up to three documentation surfaces, each with its own audience and change bar:

| Surface | Audience | Describes | Change bar |
|---------|----------|-----------|------------|
| **Developer docs** | Engineers building the system | Architecture, contracts, data flows, design rationale | Would a new team member get a wrong mental model? |
| **User-facing docs** | People using the product/platform | How to use it, configuration, expected behavior | Would a user have wrong expectations? |
| **Agent skills** | AI agents assisting with the project | Workflows, commands, patterns, reference material | Would an agent give wrong guidance? |

Not every project has all three. Identify which surfaces exist and where they live before starting the audit.

**Developer docs are for architecture, not implementation details.** They describe system structure, component boundaries, inter-component contracts, and key design decisions. They do NOT describe class names, method signatures, internal code organization, or implementation patterns within a component. The test: if a change is reverted, does the system's architecture diagram or contract specification change? If no, developer docs do not need updating.

## When to Use

- After architectural changes land (new components, removed components, contract changes, boundary shifts)
- Periodic accuracy audits
- When documentation feels stale or disorganized
- When workflows or commands change in ways that affect user-facing docs or skills

## Controller Workflow

The controller never edits documentation directly. All changes are made by specialized worker agents.

### Step 1: Discovery & Scope

Identify which documentation surfaces exist and need auditing:

- Explore the project structure to find documentation directories
- Read documentation index files or READMEs
- Identify code repos and their key entry points (interfaces, contracts, schemas, config files)
- Based on the trigger (user request, recent changes, periodic audit), decide which surfaces and docs need verification

### Step 2: Create Audit Tasks

Create tasks for both audit directions:

**Docs → code tasks** (one per doc or group of 2-3 related docs):
- Doc path(s) to verify and which surface they belong to
- Relevant code entry points to explore
- Other documentation surfaces to cross-reference
- Whether to assess structural fitness

**Code → docs tasks** (one per code area or component):
- Code area to scan and artifact types to inventory
- Documentation surfaces to check coverage against
- The change threshold to apply

### Step 3: Parallel Audit Agents (Both Directions)

Run both directions in parallel:

**Docs → code agents** (`ultrakit:audit:doc-worker`): one per task. Each reads curated files first, then searches broadly.

**Code → docs agents** (`ultrakit:audit:code-worker`): one per task. Each systematically inventories artifacts, then checks documentation coverage.

Use a fast, highly-capable model for all audit agents.

### Step 4: Synthesize Findings

Collect all reports. Apply the change threshold per surface — filter out findings below the bar. Only pass through findings that affect the audience's mental model.

Categorize actionable findings:

1. **Architectural inaccuracies** — component boundaries, contracts, or data flows that no longer reflect reality
2. **Coverage gaps** — features or components that exist in code but are missing from documentation
3. **Partial coverage** — artifacts documented but incomplete (e.g., command mentioned without new flags)
4. **Consistency issues** — contradictions between documentation surfaces
5. **Cross-reference issues** — broken links, stale anchors, missing cross-links
6. **Structural recommendations** — docs that should be split, merged, or reordered

For structural recommendations, present to the user for approval before dispatching fix agents.

### Step 5: Parallel Fix Agents

One `ultrakit:audit:doc-fixer` agent per doc (or group of related docs) that has findings. Each receives:

- Specific findings from both directions
- Which documentation surface the doc belongs to
- Code repos and related docs to gather context from

Fix agents gather their own deep context before writing. All run in parallel.

### Step 6: Verification Pass

Spawn targeted `ultrakit:audit:doc-worker` agents on changed docs to verify fixes. If verification reveals new issues, dispatch another fix agent and re-verify.

### Step 7: Commit

Single commit covering all doc updates. Subject: `Audit docs: [summary of trigger]`. Body lists which docs changed and key findings.
