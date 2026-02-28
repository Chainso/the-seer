import type {
  KeyDefinitionInput,
  KeyPartInput,
  OntologyEdge,
  OntologyNode,
  PropertyDefinitionInput,
  StateInput,
} from '@/app/types/ontology';

type NodeMap = Map<string, OntologyNode>;

const asString = (value: unknown) => (typeof value === 'string' ? value : '');

const asNumber = (value: unknown) => (typeof value === 'number' ? value : undefined);

const buildNodeMap = (nodes: OntologyNode[]) => new Map(nodes.map((node) => [node.uri, node]));

const findOutgoing = (edges: OntologyEdge[], fromUri: string, type: string) =>
  edges.filter((edge) => edge.fromUri === fromUri && edge.type === type).map((edge) => edge.toUri);

const findIncoming = (edges: OntologyEdge[], toUri: string, type: string) =>
  edges.filter((edge) => edge.toUri === toUri && edge.type === type).map((edge) => edge.fromUri);

const findSingleOutgoing = (edges: OntologyEdge[], fromUri: string, type: string) =>
  edges.find((edge) => edge.fromUri === fromUri && edge.type === type)?.toUri;

export const mapPropertyDefinitions = (
  containerUri: string,
  nodes: OntologyNode[],
  edges: OntologyEdge[]
): PropertyDefinitionInput[] => {
  const nodeMap = buildNodeMap(nodes);
  return findOutgoing(edges, containerUri, 'hasProperty').map((propUri) => {
    const node = nodeMap.get(propUri);
    const valueTypeUri = findSingleOutgoing(edges, propUri, 'valueType') || '';
    return {
      uri: propUri,
      name: asString(node?.properties.name) || propUri,
      description: asString(node?.properties.description) || undefined,
      documentation: asString(node?.properties.documentation) || undefined,
      fieldKey: asString(node?.properties.fieldKey) || '',
      valueTypeUri,
      minCardinality: asNumber(node?.properties.minCardinality) ?? undefined,
      maxCardinality: asNumber(node?.properties.maxCardinality) ?? undefined,
    };
  });
};

export const mapKeyDefinition = (
  objectUri: string,
  relationType: 'hasPrimaryKey' | 'hasDisplayKey',
  nodes: OntologyNode[],
  edges: OntologyEdge[]
): KeyDefinitionInput => {
  const nodeMap = buildNodeMap(nodes);
  const keyUri = findSingleOutgoing(edges, objectUri, relationType);
  const keyNode = keyUri ? nodeMap.get(keyUri) : undefined;
  const keyParts: KeyPartInput[] = [];

  if (keyUri) {
    const partUris = findOutgoing(edges, keyUri, 'hasKeyPart');
    for (const partUri of partUris) {
      const partNode = nodeMap.get(partUri);
      const partPropertyUri = findSingleOutgoing(edges, partUri, 'partProperty') || '';
      keyParts.push({
        uri: partUri,
        name: asString(partNode?.properties.name) || 'Key Part',
        description: asString(partNode?.properties.description) || undefined,
        documentation: asString(partNode?.properties.documentation) || undefined,
        partIndex: asNumber(partNode?.properties.partIndex) ?? 0,
        partPropertyUri,
      });
    }
  }

  keyParts.sort((a, b) => a.partIndex - b.partIndex);

  return {
    uri: keyUri || undefined,
    name: asString(keyNode?.properties.name) || relationType,
    description: asString(keyNode?.properties.description) || undefined,
    documentation: asString(keyNode?.properties.documentation) || undefined,
    keyParts,
  };
};

export const mapStates = (
  objectUri: string,
  nodes: OntologyNode[],
  edges: OntologyEdge[]
): StateInput[] => {
  const nodeMap = buildNodeMap(nodes);
  return findOutgoing(edges, objectUri, 'hasPossibleState').map((stateUri) => {
    const node = nodeMap.get(stateUri);
    return {
      uri: stateUri,
      name: asString(node?.properties.name) || stateUri,
      description: asString(node?.properties.description) || undefined,
      documentation: asString(node?.properties.documentation) || undefined,
    };
  });
};

export const mapInitialStateUri = (
  objectUri: string,
  edges: OntologyEdge[]
) => findSingleOutgoing(edges, objectUri, 'initialState');

export const mapActionIo = (
  actionUri: string,
  relationType: 'acceptsInput' | 'producesEvent',
  nodes: OntologyNode[],
  edges: OntologyEdge[]
) => {
  const nodeMap = buildNodeMap(nodes);
  const ioUri = findSingleOutgoing(edges, actionUri, relationType);
  const node = ioUri ? nodeMap.get(ioUri) : undefined;
  return {
    uri: ioUri || undefined,
    name: asString(node?.properties.name) || '',
    description: asString(node?.properties.description) || undefined,
    documentation: asString(node?.properties.documentation) || undefined,
    properties: ioUri ? mapPropertyDefinitions(ioUri, nodes, edges) : [],
  };
};

export const mapTransitionDefinition = (
  transitionUri: string,
  nodes: OntologyNode[],
  edges: OntologyEdge[]
) => {
  const nodeMap = buildNodeMap(nodes);
  const node = nodeMap.get(transitionUri);
  return {
    uri: transitionUri,
    name: asString(node?.properties.name) || transitionUri,
    description: asString(node?.properties.description) || undefined,
    documentation: asString(node?.properties.documentation) || undefined,
    transitionOfUri: findSingleOutgoing(edges, transitionUri, 'transitionOf') || '',
    fromStateUri: findSingleOutgoing(edges, transitionUri, 'fromState') || '',
    toStateUri: findSingleOutgoing(edges, transitionUri, 'toState') || '',
    properties: mapPropertyDefinitions(transitionUri, nodes, edges),
  };
};

export const mapTriggerDefinition = (
  triggerUri: string,
  nodes: OntologyNode[],
  edges: OntologyEdge[]
) => {
  const nodeMap = buildNodeMap(nodes);
  const node = nodeMap.get(triggerUri);
  return {
    uri: triggerUri,
    name: asString(node?.properties.name) || triggerUri,
    description: asString(node?.properties.description) || undefined,
    documentation: asString(node?.properties.documentation) || undefined,
    listensToUri: findSingleOutgoing(edges, triggerUri, 'listensTo') || '',
    invokesUri: findSingleOutgoing(edges, triggerUri, 'invokes') || '',
  };
};

export const mapEventDefinition = (
  eventUri: string,
  nodes: OntologyNode[],
  edges: OntologyEdge[]
) => {
  const nodeMap = buildNodeMap(nodes);
  const node = nodeMap.get(eventUri);
  return {
    uri: eventUri,
    name: asString(node?.properties.name) || eventUri,
    description: asString(node?.properties.description) || undefined,
    documentation: asString(node?.properties.documentation) || undefined,
    properties: mapPropertyDefinitions(eventUri, nodes, edges),
  };
};

export const findTransitionsForObject = (
  objectUri: string,
  edges: OntologyEdge[]
) => findIncoming(edges, objectUri, 'transitionOf');
