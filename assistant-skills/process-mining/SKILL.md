---
name: process-mining
description: Use when the user wants to inspect process flow, compare paths, understand delays across a time window, or see an OC-DFG for an object type.
allowed-tools: process.mine process.traces
---

# Process Mining

Use this skill when the user is asking about operational flow, path divergence, bottlenecks, delays, churn, or wants to visualize how an object moves through the system.

Guidance:

- Confirm the anchor object type and time window before expensive mining runs when they are missing.
- Prefer OC-DFG style analysis when the user wants to understand the dominant path, where work branches, or where objects stall.
- Use trace drilldown when the user asks for examples behind an edge, path, or activity.
- Keep causal language careful. Process mining shows behavior and sequence, not proof of root cause on its own.

