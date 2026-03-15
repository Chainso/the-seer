import type { OntologyEdge, OntologyNode } from "@/app/types/ontology";

export interface OntologyPropertyDefinition {
  uri: string;
  name: string;
  description?: string;
  documentation?: string;
  fieldKey: string;
  valueTypeUri: string;
  minCardinality?: number;
  maxCardinality?: number;
}

const asString = (value: unknown) => (typeof value === "string" ? value : "");

const asNumber = (value: unknown) => (typeof value === "number" ? value : undefined);

const displayName = (node: OntologyNode | undefined, fallback = "") =>
  asString(node?.properties["prophet:name"]) || asString(node?.properties.name) || fallback;

const buildNodeMap = (nodes: OntologyNode[]) => new Map(nodes.map((node) => [node.uri, node]));

const findOutgoing = (edges: OntologyEdge[], fromUri: string, type: string) =>
  edges.filter((edge) => edge.fromUri === fromUri && edge.type === type).map((edge) => edge.toUri);

const findSingleOutgoing = (edges: OntologyEdge[], fromUri: string, type: string) =>
  edges.find((edge) => edge.fromUri === fromUri && edge.type === type)?.toUri;

export const mapPropertyDefinitions = (
  containerUri: string,
  nodes: OntologyNode[],
  edges: OntologyEdge[]
): OntologyPropertyDefinition[] => {
  const nodeMap = buildNodeMap(nodes);
  return findOutgoing(edges, containerUri, "hasProperty").map((propUri) => {
    const node = nodeMap.get(propUri);
    const valueTypeUri = findSingleOutgoing(edges, propUri, "valueType") || "";
    return {
      uri: propUri,
      name: displayName(node, propUri),
      description: asString(node?.properties.description) || undefined,
      documentation: asString(node?.properties.documentation) || undefined,
      fieldKey: asString(node?.properties.fieldKey) || "",
      valueTypeUri,
      minCardinality: asNumber(node?.properties.minCardinality) ?? undefined,
      maxCardinality: asNumber(node?.properties.maxCardinality) ?? undefined,
    };
  });
};
