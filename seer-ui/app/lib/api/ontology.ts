/**
 * API functions for ontology operations.
 *
 * Phase A contract direction:
 * - graph/read paths are composed from canonical `/api/v1/ontology/*` reads
 * - mutation paths are intentionally unsupported (read-only ontology UI boundary)
 */

import type {
  OntologyGraph,
  OntologyNode,
  OntologyEdge,
  CreateObjectModelRequest,
  CreateActionRequest,
  CreateSignalRequest,
  CreateStateRequest,
  CreateTransitionRequest,
  CreateEventTriggerRequest,
  CreateLocalOntologyRequest,
  CreateCustomTypeRequest,
  CreateStructTypeRequest,
  CreateListTypeRequest,
  UpdateConceptRequest,
  NodeLabel,
} from '@/app/types/ontology';
import { fetchApi } from './client';

interface OntologyConceptSummaryResponse {
  iri: string;
  label: string;
  category: string;
}

interface OntologyConceptDetailResponse {
  iri: string;
  label: string;
  category: string;
  comment: string | null;
  outgoing_relations: string[];
  incoming_relations: string[];
}

interface OntologySparqlQueryResponse {
  query_type: 'SELECT' | 'ASK';
  bindings?: Array<Record<string, string>>;
}

interface OntologyGraphNodeResponse {
  iri: string;
  label: string;
  category: string;
  comment: string | null;
  properties?: Record<string, unknown>;
}

interface OntologyGraphEdgeResponse {
  from_iri: string;
  to_iri: string;
  predicate: string;
}

interface OntologyGraphResponse {
  release_id: string;
  graph_iri: string;
  nodes: OntologyGraphNodeResponse[];
  edges: OntologyGraphEdgeResponse[];
}

const USER_CONCEPT_PREFIX_EXCLUSIONS = [
  'http://prophet.platform/ontology#',
  'http://prophet.platform/standard-types#',
  'http://www.w3.org/',
] as const;

const CATEGORY_TO_NODE_LABEL: Record<string, NodeLabel> = {
  ObjectModel: 'ObjectModel',
  State: 'State',
  Action: 'Action',
  Process: 'Process',
  Workflow: 'Workflow',
  Signal: 'Signal',
  Transition: 'Transition',
  Event: 'Event',
  ActionInput: 'ActionInput',
  EventTrigger: 'EventTrigger',
  LocalOntology: 'LocalOntology',
  PropertyDefinition: 'PropertyDefinition',
  NodeShape: 'NodeShape',
  Class: 'Class',
  EventInterface: 'EventInterface',
  KeyDefinition: 'KeyDefinition',
  KeyPart: 'KeyPart',
  ObjectInterface: 'ObjectInterface',
  Taxonomy: 'Taxonomy',
  Type: 'Type',
  BaseType: 'BaseType',
  CustomType: 'CustomType',
  StructType: 'StructType',
  ListType: 'ListType',
  ObjectReference: 'ObjectReference',
};

const CONCEPT_QUERY = `
PREFIX prophet: <http://prophet.platform/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?concept ?category ?label ?comment
WHERE {
  ?concept a ?categoryIri .
  FILTER(isIRI(?concept))
  FILTER(
    !STRSTARTS(STR(?concept), "http://prophet.platform/ontology#") &&
    !STRSTARTS(STR(?concept), "http://prophet.platform/standard-types#") &&
    !STRSTARTS(STR(?concept), "http://www.w3.org/")
  )
  OPTIONAL { ?concept prophet:name ?prophetName . }
  OPTIONAL { ?concept rdfs:label ?rdfsLabel . }
  OPTIONAL { ?concept rdfs:comment ?comment . }
  BIND(REPLACE(STR(?categoryIri), "^.*[#/]", "") AS ?category)
  BIND(COALESCE(STR(?prophetName), STR(?rdfsLabel), STR(?concept)) AS ?label)
}
LIMIT 5000
`.trim();

const EDGE_QUERY = `
SELECT DISTINCT ?from ?predicate ?to
WHERE {
  ?from ?predicate ?to .
  FILTER(isIRI(?from) && isIRI(?to))
  FILTER(
    !STRSTARTS(STR(?from), "http://prophet.platform/ontology#") &&
    !STRSTARTS(STR(?from), "http://prophet.platform/standard-types#") &&
    !STRSTARTS(STR(?from), "http://www.w3.org/")
  )
  FILTER(
    !STRSTARTS(STR(?to), "http://prophet.platform/ontology#") &&
    !STRSTARTS(STR(?to), "http://prophet.platform/standard-types#") &&
    !STRSTARTS(STR(?to), "http://www.w3.org/")
  )
  FILTER(STRSTARTS(STR(?predicate), "http://prophet.platform/ontology#"))
}
LIMIT 20000
`.trim();

let ontologyGraphPromise: Promise<OntologyGraph> | null = null;

async function runOntologySelectQuery(query: string): Promise<Array<Record<string, string>>> {
  const response = await fetchApi<OntologySparqlQueryResponse>('/ontology/query', {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
  return Array.isArray(response.bindings) ? response.bindings : [];
}

function toNodeLabel(category: string | undefined): NodeLabel {
  if (!category) return 'Class';
  return CATEGORY_TO_NODE_LABEL[category] || 'Class';
}

function iriLocalName(iri: string): string {
  const hashIndex = iri.lastIndexOf('#');
  if (hashIndex >= 0 && hashIndex < iri.length - 1) {
    return iri.slice(hashIndex + 1);
  }
  const slashIndex = iri.lastIndexOf('/');
  if (slashIndex >= 0 && slashIndex < iri.length - 1) {
    return iri.slice(slashIndex + 1);
  }
  return iri;
}

function shouldIncludeConceptIri(iri: string): boolean {
  return !USER_CONCEPT_PREFIX_EXCLUSIONS.some((prefix) => iri.startsWith(prefix));
}

function baseNodeProperties(
  label: string,
  category: string | undefined,
  comment?: string | null
): Record<string, unknown> {
  return {
    name: label,
    category: category || 'Concept',
    description: comment || undefined,
    documentation: comment || undefined,
  };
}

function adaptGraphResponse(response: OntologyGraphResponse): OntologyGraph {
  const nodesByUri = new Map<string, OntologyNode>();
  for (const node of response.nodes || []) {
    if (!node?.iri || !shouldIncludeConceptIri(node.iri)) {
      continue;
    }
    nodesByUri.set(node.iri, {
      uri: node.iri,
      label: toNodeLabel(node.category),
      properties: {
        ...(node.properties || {}),
        ...baseNodeProperties(node.label || iriLocalName(node.iri), node.category, node.comment),
      },
    });
  }

  const edgeKeys = new Set<string>();
  const edges: OntologyEdge[] = [];
  for (const edge of response.edges || []) {
    if (!edge?.from_iri || !edge?.to_iri || !edge?.predicate) {
      continue;
    }
    if (!nodesByUri.has(edge.from_iri) || !nodesByUri.has(edge.to_iri)) {
      continue;
    }
    const type = iriLocalName(edge.predicate);
    const key = `${edge.from_iri}|${type}|${edge.to_iri}`;
    if (edgeKeys.has(key)) {
      continue;
    }
    edgeKeys.add(key);
    edges.push({
      fromUri: edge.from_iri,
      toUri: edge.to_iri,
      type,
    });
  }

  return {
    nodes: Array.from(nodesByUri.values()),
    edges,
  };
}

async function fetchGraphFromCanonicalEndpoint(): Promise<OntologyGraph> {
  const response = await fetchApi<OntologyGraphResponse>('/ontology/graph');
  return adaptGraphResponse(response);
}

async function composeOntologyGraph(): Promise<OntologyGraph> {
  const [conceptRows, edgeRows, conceptSummaries] = await Promise.all([
    runOntologySelectQuery(CONCEPT_QUERY),
    runOntologySelectQuery(EDGE_QUERY),
    fetchApi<OntologyConceptSummaryResponse[]>('/ontology/concepts?search=&limit=200'),
  ]);

  const detailResults = await Promise.allSettled(
    conceptSummaries.map((concept) =>
      fetchApi<OntologyConceptDetailResponse>(
        `/ontology/concept-detail?iri=${encodeURIComponent(concept.iri)}`
      )
    )
  );

  const detailByIri = new Map<string, OntologyConceptDetailResponse>();
  for (const result of detailResults) {
    if (result.status === 'fulfilled') {
      detailByIri.set(result.value.iri, result.value);
    }
  }

  const nodesByUri = new Map<string, OntologyNode>();

  for (const row of conceptRows) {
    const uri = row.concept;
    if (!uri || !shouldIncludeConceptIri(uri)) {
      continue;
    }
    const category = row.category;
    const label = row.label || iriLocalName(uri);
    const comment = row.comment;
    nodesByUri.set(uri, {
      uri,
      label: toNodeLabel(category),
      properties: baseNodeProperties(label, category, comment),
    });
  }

  for (const summary of conceptSummaries) {
    if (!shouldIncludeConceptIri(summary.iri)) {
      continue;
    }
    const detail = detailByIri.get(summary.iri);
    const category = detail?.category || summary.category;
    const label = detail?.label || summary.label;
    const existing = nodesByUri.get(summary.iri);
    const properties = {
      ...(existing?.properties || {}),
      ...baseNodeProperties(label, category, detail?.comment),
      outgoingRelations: detail?.outgoing_relations || [],
      incomingRelations: detail?.incoming_relations || [],
    };

    nodesByUri.set(summary.iri, {
      uri: summary.iri,
      label: toNodeLabel(category),
      properties,
    });
  }

  const edges: OntologyEdge[] = [];
  const edgeKeys = new Set<string>();

  for (const row of edgeRows) {
    const fromUri = row.from;
    const toUri = row.to;
    const predicate = row.predicate;
    if (!fromUri || !toUri || !predicate) {
      continue;
    }
    if (!nodesByUri.has(fromUri) || !nodesByUri.has(toUri)) {
      continue;
    }
    const type = iriLocalName(predicate);
    const dedupeKey = `${fromUri}|${type}|${toUri}`;
    if (edgeKeys.has(dedupeKey)) {
      continue;
    }
    edgeKeys.add(dedupeKey);
    edges.push({
      fromUri,
      toUri,
      type,
    });
  }

  return {
    nodes: Array.from(nodesByUri.values()),
    edges,
  };
}

function throwReadOnlyMutationError(functionName: string): never {
  throw new Error(
    `Ontology mutation API '${functionName}' is disabled: ontology integrations are read-only via canonical /api/v1 contracts.`
  );
}

// ===== Graph Queries =====

/**
 * Fetch the ontology graph by composing canonical read-only endpoints.
 */
export async function getOntologyGraph(): Promise<OntologyGraph> {
  if (!ontologyGraphPromise) {
    ontologyGraphPromise = fetchGraphFromCanonicalEndpoint()
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('404')) {
          // Backward-compatible fallback while rolling out `/ontology/graph`.
          return composeOntologyGraph();
        }
        throw error;
      })
      .catch((error) => {
        ontologyGraphPromise = null;
        throw error;
      });
  }
  return ontologyGraphPromise;
}

/**
 * Filter nodes by label (client-side).
 */
export async function getNodesByLabel(label: NodeLabel | NodeLabel[]): Promise<OntologyNode[]> {
  const graph = await getOntologyGraph();
  const labels = Array.isArray(label) ? label : [label];
  const filtered = graph.nodes.filter((node) => labels.includes(node.label as NodeLabel));
  if (typeof window !== 'undefined') {
    console.debug('[ontology] nodes by label', { labels, count: filtered.length });
  }
  return filtered;
}

// ===== Mutation APIs (Unsupported in read-only mode) =====

export async function createObjectModel(
  data: CreateObjectModelRequest
): Promise<OntologyNode> {
  void data;
  return throwReadOnlyMutationError('createObjectModel');
}

export async function updateObjectModel(
  uri: string,
  data: Omit<UpdateConceptRequest, 'uri'>
): Promise<OntologyNode> {
  void uri;
  void data;
  return throwReadOnlyMutationError('updateObjectModel');
}

export async function updateObjectModelDefinition(
  uri: string,
  data: CreateObjectModelRequest
): Promise<OntologyNode> {
  void uri;
  void data;
  return throwReadOnlyMutationError('updateObjectModelDefinition');
}

export async function createAction(data: CreateActionRequest): Promise<OntologyNode> {
  void data;
  return throwReadOnlyMutationError('createAction');
}

export async function updateAction(
  uri: string,
  data: Omit<UpdateConceptRequest, 'uri'>
): Promise<OntologyNode> {
  void uri;
  void data;
  return throwReadOnlyMutationError('updateAction');
}

export async function updateActionDefinition(
  uri: string,
  data: CreateActionRequest
): Promise<OntologyNode> {
  void uri;
  void data;
  return throwReadOnlyMutationError('updateActionDefinition');
}

export async function createSignal(data: CreateSignalRequest): Promise<OntologyNode> {
  void data;
  return throwReadOnlyMutationError('createSignal');
}

export async function updateSignal(
  uri: string,
  data: Omit<UpdateConceptRequest, 'uri'>
): Promise<OntologyNode> {
  void uri;
  void data;
  return throwReadOnlyMutationError('updateSignal');
}

export async function updateSignalDefinition(
  uri: string,
  data: CreateSignalRequest
): Promise<OntologyNode> {
  void uri;
  void data;
  return throwReadOnlyMutationError('updateSignalDefinition');
}

export async function createState(data: CreateStateRequest): Promise<OntologyNode> {
  void data;
  return throwReadOnlyMutationError('createState');
}

export async function updateState(
  uri: string,
  data: Omit<UpdateConceptRequest, 'uri'>
): Promise<OntologyNode> {
  void uri;
  void data;
  return throwReadOnlyMutationError('updateState');
}

export async function createTransition(data: CreateTransitionRequest): Promise<OntologyNode> {
  void data;
  return throwReadOnlyMutationError('createTransition');
}

export async function updateTransition(
  uri: string,
  data: Omit<UpdateConceptRequest, 'uri'>
): Promise<OntologyNode> {
  void uri;
  void data;
  return throwReadOnlyMutationError('updateTransition');
}

export async function updateTransitionDefinition(
  uri: string,
  data: CreateTransitionRequest
): Promise<OntologyNode> {
  void uri;
  void data;
  return throwReadOnlyMutationError('updateTransitionDefinition');
}

export async function createEventTrigger(
  data: CreateEventTriggerRequest
): Promise<OntologyNode> {
  void data;
  return throwReadOnlyMutationError('createEventTrigger');
}

export async function updateEventTrigger(
  uri: string,
  data: Omit<UpdateConceptRequest, 'uri'>
): Promise<OntologyNode> {
  void uri;
  void data;
  return throwReadOnlyMutationError('updateEventTrigger');
}

export async function updateEventTriggerDefinition(
  uri: string,
  data: CreateEventTriggerRequest
): Promise<OntologyNode> {
  void uri;
  void data;
  return throwReadOnlyMutationError('updateEventTriggerDefinition');
}

export async function createLocalOntology(
  data: CreateLocalOntologyRequest
): Promise<OntologyNode> {
  void data;
  return throwReadOnlyMutationError('createLocalOntology');
}

export async function updateLocalOntology(
  uri: string,
  data: Omit<UpdateConceptRequest, 'uri'>
): Promise<OntologyNode> {
  void uri;
  void data;
  return throwReadOnlyMutationError('updateLocalOntology');
}

export async function createCustomType(
  data: CreateCustomTypeRequest
): Promise<OntologyNode> {
  void data;
  return throwReadOnlyMutationError('createCustomType');
}

export async function createStructType(
  data: CreateStructTypeRequest
): Promise<OntologyNode> {
  void data;
  return throwReadOnlyMutationError('createStructType');
}

export async function createListType(
  data: CreateListTypeRequest
): Promise<OntologyNode> {
  void data;
  return throwReadOnlyMutationError('createListType');
}

export async function updateCustomType(
  uri: string,
  data: Omit<UpdateConceptRequest, 'uri'>
): Promise<OntologyNode> {
  void uri;
  void data;
  return throwReadOnlyMutationError('updateCustomType');
}

export async function updateStructType(
  uri: string,
  data: Omit<UpdateConceptRequest, 'uri'>
): Promise<OntologyNode> {
  void uri;
  void data;
  return throwReadOnlyMutationError('updateStructType');
}

export async function updateListType(
  uri: string,
  data: Omit<UpdateConceptRequest, 'uri'>
): Promise<OntologyNode> {
  void uri;
  void data;
  return throwReadOnlyMutationError('updateListType');
}
