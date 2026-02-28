import type { OntologyEdge, OntologyNode } from '@/app/types/ontology';

const EDGE_HAS_PROPERTY = 'hasProperty';
const EDGE_VALUE_TYPE = 'valueType';
const EDGE_REFERENCES_OBJECT_MODEL = 'referencesObjectModel';
const EDGE_ITEM_TYPE = 'itemType';
const EDGE_ACCEPTS_INPUT = 'acceptsInput';
const EDGE_PRODUCES_OUTPUT = 'producesEvent';

const ACTION_LABELS = new Set(['Action', 'Process', 'Workflow']);

export function buildReferenceEdges(nodes: OntologyNode[], edges: OntologyEdge[]): OntologyEdge[] {
  const edgesByFrom = new Map<string, OntologyEdge[]>();

  for (const edge of edges) {
    const list = edgesByFrom.get(edge.fromUri);
    if (list) {
      list.push(edge);
    } else {
      edgesByFrom.set(edge.fromUri, [edge]);
    }
  }

  const getTargets = (fromUri: string, type: string) =>
    (edgesByFrom.get(fromUri) || [])
      .filter((edge) => edge.type === type)
      .map((edge) => edge.toUri);

  const resolveReferencedObjectModels = (typeUri: string, visited: Set<string>, out: Set<string>) => {
    if (visited.has(typeUri)) {
      return;
    }
    visited.add(typeUri);

    getTargets(typeUri, EDGE_REFERENCES_OBJECT_MODEL).forEach((modelUri) => out.add(modelUri));

    getTargets(typeUri, EDGE_ITEM_TYPE).forEach((itemTypeUri) => {
      resolveReferencedObjectModels(itemTypeUri, visited, out);
    });

    getTargets(typeUri, EDGE_HAS_PROPERTY).forEach((propUri) => {
      getTargets(propUri, EDGE_VALUE_TYPE).forEach((valueTypeUri) => {
        resolveReferencedObjectModels(valueTypeUri, visited, out);
      });
    });
  };

  const collectPropertyReferences = (containerUri: string) => {
    const referenced = new Set<string>();
    const propertyUris = getTargets(containerUri, EDGE_HAS_PROPERTY);
    for (const propUri of propertyUris) {
      const valueTypes = getTargets(propUri, EDGE_VALUE_TYPE);
      for (const valueTypeUri of valueTypes) {
        resolveReferencedObjectModels(valueTypeUri, new Set<string>(), referenced);
      }
    }
    return referenced;
  };

  const derivedEdges = new Map<string, OntologyEdge>();

  for (const node of nodes) {
    let referenced = new Set<string>();
    if (ACTION_LABELS.has(node.label)) {
      const inputUris = getTargets(node.uri, EDGE_ACCEPTS_INPUT);
      const outputUris = getTargets(node.uri, EDGE_PRODUCES_OUTPUT);
      for (const ioUri of [...inputUris, ...outputUris]) {
        collectPropertyReferences(ioUri).forEach((ref) => referenced.add(ref));
      }
    } else {
      referenced = collectPropertyReferences(node.uri);
    }

    for (const targetUri of referenced) {
      const key = `${node.uri}|${EDGE_REFERENCES_OBJECT_MODEL}|${targetUri}`;
      if (!derivedEdges.has(key)) {
        derivedEdges.set(key, {
          fromUri: node.uri,
          toUri: targetUri,
          type: EDGE_REFERENCES_OBJECT_MODEL,
        });
      }
    }
  }

  return Array.from(derivedEdges.values());
}
