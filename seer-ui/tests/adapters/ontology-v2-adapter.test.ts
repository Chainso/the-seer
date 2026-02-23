import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_RELATION_SCOPE_FILTERS,
  adaptOntologyNeighborhoodGraph,
  buildOntologyNeighborhoodQuery,
  buildOntologyTabCounts,
  filterOntologyConceptsForTab,
  normalizeOntologyTab,
} from "@/lib/adapters/ontology-v2-adapter";
import type { OntologyConceptSummary, OntologySparqlQueryResponse } from "@/lib/backend-ontology";

const concepts: OntologyConceptSummary[] = [
  { iri: "seer:Order", label: "Order", category: "ObjectModel" },
  { iri: "seer:Fulfill", label: "Fulfill", category: "Action" },
  { iri: "seer:OrderDelayed", label: "Order Delayed", category: "Signal" },
];

test("normalizeOntologyTab falls back to overview and tab counts remain deterministic", () => {
  assert.equal(normalizeOntologyTab(undefined), "overview");
  assert.equal(normalizeOntologyTab("invalid"), "overview");
  assert.equal(normalizeOntologyTab("actions"), "actions");

  const counts = buildOntologyTabCounts(concepts);
  assert.deepEqual(counts, {
    overview: 3,
    objects: 1,
    actions: 1,
    events: 1,
    triggers: 2,
  });

  const events = filterOntologyConceptsForTab(concepts, "events");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.label, "Order Delayed");
});

test("buildOntologyNeighborhoodQuery validates IRIs and clamps row budget", () => {
  assert.throws(
    () => buildOntologyNeighborhoodQuery("not-a-valid-iri", 10),
    /invalid concept IRI/i
  );

  const query = buildOntologyNeighborhoodQuery("seer:Order", 999);
  assert.match(query, /LIMIT 250/);
  assert.match(query, /SELECT \?direction \?predicate \?neighbor/);
});

test("adaptOntologyNeighborhoodGraph deduplicates predicates, respects filters, and reports truncation", () => {
  const focus = concepts[0]!;
  const queryResponse: OntologySparqlQueryResponse = {
    query_type: "SELECT",
    bindings: [
      {
        direction: "outgoing",
        predicate: "http://prophet.platform/ontology#hasPossibleState",
        neighbor: "seer:OrderDelayed",
        neighborLabel: "Order Delayed",
        neighborCategory: "Signal",
      },
      {
        direction: "outgoing",
        predicate: "http://prophet.platform/ontology#toState",
        neighbor: "seer:OrderDelayed",
        neighborLabel: "Order Delayed",
        neighborCategory: "Signal",
      },
      {
        direction: "incoming",
        predicate: "http://prophet.platform/ontology#listensTo",
        neighbor: "seer:Fulfill",
        neighborLabel: "Fulfill",
        neighborCategory: "Action",
      },
    ],
    ask_result: null,
    graphs: [],
  };

  const clamped = adaptOntologyNeighborhoodGraph({
    focus,
    concepts,
    queryResponse,
    tab: "overview",
    scopeFilters: { ...DEFAULT_RELATION_SCOPE_FILTERS },
    maxEdges: 1,
  });

  assert.equal(clamped.edges.length, 2);
  assert.equal(clamped.total_edges, 2);
  assert.equal(clamped.truncated, false);
  assert.equal(clamped.nodes[0]?.iri, "seer:Order");

  const denseGraph = adaptOntologyNeighborhoodGraph({
    focus,
    concepts,
    queryResponse: {
      ...queryResponse,
      bindings: [
        ...queryResponse.bindings,
        ...Array.from({ length: 10 }, (_, index) => ({
          direction: "outgoing",
          predicate: "http://prophet.platform/ontology#referencesObjectModel",
          neighbor: `seer:Neighbor${index}`,
          neighborLabel: `Neighbor ${index}`,
          neighborCategory: "ObjectModel",
        })),
      ],
    },
    tab: "overview",
    scopeFilters: { ...DEFAULT_RELATION_SCOPE_FILTERS },
    maxEdges: 1,
  });

  assert.equal(denseGraph.edges.length, 8);
  assert.equal(denseGraph.truncated, true);

  const lifecycleOnly = adaptOntologyNeighborhoodGraph({
    focus,
    concepts,
    queryResponse,
    tab: "overview",
    scopeFilters: {
      structure: true,
      lifecycle: true,
      automation: false,
      reference: true,
    },
    maxEdges: 10,
  });

  assert.equal(lifecycleOnly.edges.length, 1);
  assert.deepEqual(lifecycleOnly.edges[0]?.predicates.sort(), ["hasPossibleState", "toState"]);
});
