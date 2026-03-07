---
name: object-history
description: Use when the user wants to inspect the event sequence for a specific object, understand how one entity changed over time, or traverse the relations around an object.
allowed-tools: history.object_events history.relations history.object_timeline
---

# Object History

Use this skill when the user is asking for the timeline of one object, the events linked to it, or the neighboring objects connected through shared events.

Guidance:

- Make sure the object type and a stable object reference are available before querying.
- Use event history when the user wants the sequence of events.
- Use relations when the user wants neighboring entities or linked context.
- Keep the time window explicit when the question is bounded in time.

