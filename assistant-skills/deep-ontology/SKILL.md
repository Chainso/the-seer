---
name: deep-ontology
description: Use when the user wants to inspect ontology structure in depth, verify relationships precisely, browse graph structure, or reason carefully about model semantics.
allowed-tools: ontology.current ontology.concepts ontology.concept_detail ontology.graph ontology.query(read_only)
---

# Deep Ontology

Use this skill when the base ontology-grounded assistant behavior is not enough and the user needs a more exact ontology investigation.

Guidance:

- Prefer concept and graph exploration before writing custom SPARQL.
- Use read-only SPARQL only when exact validation or bounded enumeration is needed.
- Distinguish ontology facts from interpretation.
- Keep answers grounded in the active ontology release.

