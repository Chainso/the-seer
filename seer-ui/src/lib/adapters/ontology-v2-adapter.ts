import { buildViewModelMeta, type ViewModelMeta } from "@/lib/adapters/common";
import type {
  OntologyConceptDetail,
  OntologyConceptSummary,
  OntologySparqlQueryResponse,
} from "@/lib/backend-ontology";

const ONTOLOGY_IRI_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>]*$/;
const PREDICATE_LOCAL_NAME_PATTERN = /^.*[#/]/;

const OBJECT_CATEGORIES = new Set([
  "ObjectModel",
  "State",
  "Transition",
  "ObjectReference",
  "CustomType",
  "StructType",
  "ListType",
]);
const ACTION_CATEGORIES = new Set(["Action", "Process", "Workflow", "ActionInput"]);
const EVENT_CATEGORIES = new Set(["Signal", "Transition", "State"]);

const LIFECYCLE_PREDICATES = new Set([
  "haspossiblestate",
  "initialstate",
  "transitionof",
  "fromstate",
  "tostate",
  "isstateof",
  "transition",
]);
const AUTOMATION_PREDICATES = new Set([
  "listensto",
  "invokes",
  "eventtrigger",
  "producesevent",
  "triggers",
  "respondsto",
  "emits",
  "consumes",
]);
const REFERENCE_PREDICATES = new Set([
  "referencesobjectmodel",
  "hasproperty",
  "valuetype",
  "itemtype",
  "acceptsinput",
]);

export type OntologyExplorerTab = "overview" | "objects" | "actions" | "events" | "triggers";

export type OntologyRelationScope = "structure" | "lifecycle" | "automation" | "reference";

export type OntologyRelationScopeFilters = Record<OntologyRelationScope, boolean>;

export type OntologyTabMeta = {
  title: string;
  summary: string;
};

export type OntologyTabCounts = Record<OntologyExplorerTab, number>;

export type OntologyRelationViewModel = {
  iri: string;
  label: string;
  scope: OntologyRelationScope;
};

export type OntologyGraphNodeViewModel = {
  iri: string;
  label: string;
  category: string;
  is_focus: boolean;
  degree: number;
};

export type OntologyGraphEdgeViewModel = {
  id: string;
  source_iri: string;
  target_iri: string;
  direction: "incoming" | "outgoing";
  scope: OntologyRelationScope;
  predicates: string[];
  primary_predicate: string;
};

export type OntologyNeighborhoodGraphViewModel = {
  focus_iri: string;
  nodes: OntologyGraphNodeViewModel[];
  edges: OntologyGraphEdgeViewModel[];
  total_edges: number;
  truncated: boolean;
  meta: ViewModelMeta;
};

type OntologyNeighborRow = {
  direction: "incoming" | "outgoing";
  predicate: string;
  neighbor: string;
  neighbor_label: string;
  neighbor_category: string;
};

export const ONTOLOGY_TABS: OntologyExplorerTab[] = [
  "overview",
  "objects",
  "actions",
  "events",
  "triggers",
];

export const ONTOLOGY_TAB_META: Record<OntologyExplorerTab, OntologyTabMeta> = {
  overview: {
    title: "Overview",
    summary: "Cross-domain topology of objects, actions, events, and triggering behavior.",
  },
  objects: {
    title: "Objects",
    summary: "Object models, state lifecycles, and typed references.",
  },
  actions: {
    title: "Actions",
    summary: "Action and workflow contracts with input and dependency structure.",
  },
  events: {
    title: "Events",
    summary: "Signals and transition semantics across the ontology.",
  },
  triggers: {
    title: "Triggers",
    summary: "Automation edges and event-trigger neighborhoods.",
  },
};

export const DEFAULT_RELATION_SCOPE_FILTERS: OntologyRelationScopeFilters = {
  structure: true,
  lifecycle: true,
  automation: true,
  reference: true,
};

export function isValidOntologyIri(value: string): boolean {
  return ONTOLOGY_IRI_PATTERN.test(value);
}

export function normalizeOntologyTab(value: string | null | undefined): OntologyExplorerTab {
  if (!value) {
    return "overview";
  }
  return ONTOLOGY_TABS.includes(value as OntologyExplorerTab)
    ? (value as OntologyExplorerTab)
    : "overview";
}

export function predicateLabel(predicateIri: string): string {
  return predicateIri.replace(PREDICATE_LOCAL_NAME_PATTERN, "") || predicateIri;
}

function isTriggerLike(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("trigger") ||
    normalized.includes("listen") ||
    normalized.includes("invoke") ||
    normalized.includes("event")
  );
}

function isEventLike(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("event") ||
    normalized.includes("signal") ||
    normalized.includes("transition")
  );
}

function conceptBelongsToTab(concept: OntologyConceptSummary, tab: OntologyExplorerTab): boolean {
  const category = concept.category;
  if (tab === "overview") {
    return true;
  }
  if (tab === "objects") {
    return OBJECT_CATEGORIES.has(category);
  }
  if (tab === "actions") {
    return ACTION_CATEGORIES.has(category);
  }
  if (tab === "events") {
    return EVENT_CATEGORIES.has(category) || isEventLike(`${concept.label} ${concept.iri}`);
  }
  return (
    ACTION_CATEGORIES.has(category) ||
    EVENT_CATEGORIES.has(category) ||
    isTriggerLike(`${concept.label} ${concept.iri}`)
  );
}

export function filterOntologyConceptsForTab(
  concepts: OntologyConceptSummary[],
  tab: OntologyExplorerTab
): OntologyConceptSummary[] {
  return concepts
    .filter((concept) => conceptBelongsToTab(concept, tab))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function buildOntologyTabCounts(concepts: OntologyConceptSummary[]): OntologyTabCounts {
  return ONTOLOGY_TABS.reduce(
    (counts, tab) => {
      counts[tab] = filterOntologyConceptsForTab(concepts, tab).length;
      return counts;
    },
    {
      overview: 0,
      objects: 0,
      actions: 0,
      events: 0,
      triggers: 0,
    } satisfies OntologyTabCounts
  );
}

export function classifyRelationScope(predicateIri: string): OntologyRelationScope {
  const localName = predicateLabel(predicateIri).toLowerCase();
  if (LIFECYCLE_PREDICATES.has(localName)) {
    return "lifecycle";
  }
  if (AUTOMATION_PREDICATES.has(localName) || isTriggerLike(localName)) {
    return "automation";
  }
  if (REFERENCE_PREDICATES.has(localName) || localName.includes("reference")) {
    return "reference";
  }
  return "structure";
}

export function adaptOntologyConceptRelations(detail: OntologyConceptDetail): {
  outgoing: OntologyRelationViewModel[];
  incoming: OntologyRelationViewModel[];
} {
  const adaptRelation = (iri: string): OntologyRelationViewModel => ({
    iri,
    label: predicateLabel(iri),
    scope: classifyRelationScope(iri),
  });
  return {
    outgoing: detail.outgoing_relations.map(adaptRelation).sort(sortRelationLabels),
    incoming: detail.incoming_relations.map(adaptRelation).sort(sortRelationLabels),
  };
}

function sortRelationLabels(left: OntologyRelationViewModel, right: OntologyRelationViewModel): number {
  return left.label.localeCompare(right.label);
}

export function buildOntologyNeighborhoodQuery(focusIri: string, maxRows: number): string {
  if (!isValidOntologyIri(focusIri)) {
    throw new Error("Cannot build neighborhood query for an invalid concept IRI.");
  }
  const boundedRows = clamp(maxRows, 20, 250);
  return `
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX prophet: <http://prophet.platform/ontology#>
SELECT ?direction ?predicate ?neighbor ?neighborLabel ?neighborCategory
WHERE {
  {
    BIND("outgoing" AS ?direction)
    BIND(<${focusIri}> AS ?focus)
    ?focus ?predicate ?neighbor .
    FILTER(isIRI(?neighbor))
  }
  UNION
  {
    BIND("incoming" AS ?direction)
    BIND(<${focusIri}> AS ?focus)
    ?neighbor ?predicate ?focus .
    FILTER(isIRI(?neighbor))
  }
  OPTIONAL { ?neighbor prophet:name ?prophetName . }
  OPTIONAL { ?neighbor rdfs:label ?rdfsLabel . }
  OPTIONAL {
    ?neighbor a ?neighborCategoryIri .
    BIND(REPLACE(STR(?neighborCategoryIri), "^.*[#/]", "") AS ?neighborCategory)
  }
  BIND(COALESCE(STR(?prophetName), STR(?rdfsLabel), STR(?neighbor)) AS ?neighborLabel)
}
ORDER BY ?direction ?predicate ?neighbor
LIMIT ${boundedRows}
`.trim();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}

function parseNeighborRows(queryResponse: OntologySparqlQueryResponse): OntologyNeighborRow[] {
  if (queryResponse.query_type !== "SELECT") {
    return [];
  }

  return queryResponse.bindings
    .map((binding) => {
      const neighbor = binding.neighbor ?? "";
      const predicate = binding.predicate ?? "";
      if (!neighbor || !predicate || !isValidOntologyIri(neighbor) || !isValidOntologyIri(predicate)) {
        return null;
      }
      return {
        direction: binding.direction === "incoming" ? "incoming" : "outgoing",
        predicate,
        neighbor,
        neighbor_label: binding.neighborLabel ?? binding.neighbor ?? "",
        neighbor_category: binding.neighborCategory ?? "Concept",
      } satisfies OntologyNeighborRow;
    })
    .filter((row): row is OntologyNeighborRow => row !== null);
}

function isEdgeRelevantForTab(
  edge: OntologyGraphEdgeViewModel,
  nodeByIri: Map<string, OntologyGraphNodeViewModel>,
  tab: OntologyExplorerTab
): boolean {
  if (tab === "overview") {
    return true;
  }

  const source = nodeByIri.get(edge.source_iri);
  const target = nodeByIri.get(edge.target_iri);
  const categories = [source?.category ?? "", target?.category ?? ""];
  const labelContext = edge.predicates.join(" ").toLowerCase();

  if (tab === "objects") {
    return (
      edge.scope === "lifecycle" ||
      edge.scope === "reference" ||
      categories.some((category) => OBJECT_CATEGORIES.has(category))
    );
  }
  if (tab === "actions") {
    return (
      edge.scope === "automation" ||
      edge.scope === "reference" ||
      categories.some((category) => ACTION_CATEGORIES.has(category))
    );
  }
  if (tab === "events") {
    return (
      categories.some((category) => EVENT_CATEGORIES.has(category)) || isEventLike(labelContext)
    );
  }

  return edge.scope === "automation" || isTriggerLike(labelContext);
}

export function adaptOntologyNeighborhoodGraph(params: {
  focus: OntologyConceptSummary;
  concepts: OntologyConceptSummary[];
  queryResponse: OntologySparqlQueryResponse | null;
  tab: OntologyExplorerTab;
  scopeFilters: OntologyRelationScopeFilters;
  maxEdges: number;
}): OntologyNeighborhoodGraphViewModel {
  const { focus, concepts, queryResponse, tab, scopeFilters, maxEdges } = params;
  const focusNode: OntologyGraphNodeViewModel = {
    iri: focus.iri,
    label: focus.label,
    category: focus.category,
    is_focus: true,
    degree: 0,
  };

  if (!queryResponse) {
    return {
      focus_iri: focus.iri,
      nodes: [focusNode],
      edges: [],
      total_edges: 0,
      truncated: false,
      meta: buildViewModelMeta(),
    };
  }

  const conceptByIri = new Map(concepts.map((concept) => [concept.iri, concept]));
  const nodeByIri = new Map<string, OntologyGraphNodeViewModel>([[focus.iri, focusNode]]);
  const edgeByKey = new Map<string, OntologyGraphEdgeViewModel>();

  for (const row of parseNeighborRows(queryResponse)) {
    if (row.neighbor === focus.iri) {
      continue;
    }
    const scope = classifyRelationScope(row.predicate);
    if (!scopeFilters[scope]) {
      continue;
    }

    const fallbackConcept = conceptByIri.get(row.neighbor);
    if (!nodeByIri.has(row.neighbor)) {
      nodeByIri.set(row.neighbor, {
        iri: row.neighbor,
        label: fallbackConcept?.label ?? row.neighbor_label ?? row.neighbor,
        category: fallbackConcept?.category ?? row.neighbor_category ?? "Concept",
        is_focus: false,
        degree: 0,
      });
    }

    const sourceIri = row.direction === "outgoing" ? focus.iri : row.neighbor;
    const targetIri = row.direction === "outgoing" ? row.neighbor : focus.iri;
    const key = `${sourceIri}|${targetIri}|${scope}|${row.direction}`;
    const candidatePredicate = predicateLabel(row.predicate);

    const existingEdge = edgeByKey.get(key);
    if (existingEdge) {
      if (!existingEdge.predicates.includes(candidatePredicate)) {
        existingEdge.predicates.push(candidatePredicate);
      }
      continue;
    }

    edgeByKey.set(key, {
      id: key,
      source_iri: sourceIri,
      target_iri: targetIri,
      scope,
      direction: row.direction,
      predicates: [candidatePredicate],
      primary_predicate: candidatePredicate,
    });
  }

  const allEdges = Array.from(edgeByKey.values())
    .filter((edge) => isEdgeRelevantForTab(edge, nodeByIri, tab))
    .sort(sortEdges);
  const cappedEdges = allEdges.slice(0, clamp(maxEdges, 8, 160));

  const degreeByIri = new Map<string, number>();
  for (const edge of cappedEdges) {
    degreeByIri.set(edge.source_iri, (degreeByIri.get(edge.source_iri) ?? 0) + 1);
    degreeByIri.set(edge.target_iri, (degreeByIri.get(edge.target_iri) ?? 0) + 1);
  }
  degreeByIri.set(focus.iri, degreeByIri.get(focus.iri) ?? 0);

  const visibleIris = new Set<string>([focus.iri]);
  for (const edge of cappedEdges) {
    visibleIris.add(edge.source_iri);
    visibleIris.add(edge.target_iri);
  }

  const nodes = Array.from(visibleIris)
    .map((iri) => {
      const node = nodeByIri.get(iri);
      if (!node) {
        return null;
      }
      return {
        ...node,
        degree: degreeByIri.get(iri) ?? 0,
      };
    })
    .filter((node): node is OntologyGraphNodeViewModel => node !== null)
    .sort(sortNodes);

  return {
    focus_iri: focus.iri,
    nodes,
    edges: cappedEdges,
    total_edges: allEdges.length,
    truncated: allEdges.length > cappedEdges.length,
    meta: buildViewModelMeta(),
  };
}

function sortEdges(left: OntologyGraphEdgeViewModel, right: OntologyGraphEdgeViewModel): number {
  const byScope = left.scope.localeCompare(right.scope);
  if (byScope !== 0) {
    return byScope;
  }
  const byPredicate = left.primary_predicate.localeCompare(right.primary_predicate);
  if (byPredicate !== 0) {
    return byPredicate;
  }
  return left.target_iri.localeCompare(right.target_iri);
}

function sortNodes(left: OntologyGraphNodeViewModel, right: OntologyGraphNodeViewModel): number {
  if (left.is_focus && !right.is_focus) {
    return -1;
  }
  if (!left.is_focus && right.is_focus) {
    return 1;
  }
  if (left.degree !== right.degree) {
    return right.degree - left.degree;
  }
  return left.label.localeCompare(right.label);
}
