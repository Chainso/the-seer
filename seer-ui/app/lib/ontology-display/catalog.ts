import { mapPropertyDefinitions } from "../ontology-helpers";
import type { OntologyEdge, OntologyGraph, OntologyNode } from "../../types/ontology";

const EVENT_NODE_LABELS = new Set(["Event", "Signal", "Transition"]);

export type OntologyDisplayStateOption = { value: string; label: string };

export type OntologyDisplayObjectModel = {
  uri: string;
  name: string;
  localName: string;
  fieldLabelByKey: Map<string, string>;
  canonicalFieldKeys: string[];
  stateLabelByToken: Map<string, string>;
  stateFilterFieldKey: string | null;
  stateFilterOptions: OntologyDisplayStateOption[];
  propertyValueTypeByKey: Map<string, string>;
};

export type OntologyDisplayCatalog = {
  objectModels: OntologyDisplayObjectModel[];
  objectModelByUri: Map<string, OntologyDisplayObjectModel>;
  objectModelByToken: Map<string, OntologyDisplayObjectModel>;
  stateOwnerObjectByUri: Map<string, OntologyDisplayObjectModel>;
  stateOwnerObjectByToken: Map<string, OntologyDisplayObjectModel>;
  transitionOwnerObjectByUri: Map<string, OntologyDisplayObjectModel>;
  transitionOwnerObjectByToken: Map<string, OntologyDisplayObjectModel>;
  conceptLabelByToken: Map<string, string>;
  conceptFieldLabelsByToken: Map<string, Map<string, string>>;
  globalFieldLabelByKey: Map<string, string>;
  eventTypeLabelByToken: Map<string, string>;
};

const PREFERRED_NAME_KEYS = ["prophet:name", "name"] as const;

export function iriLocalName(iri: string): string {
  const hashIndex = iri.lastIndexOf("#");
  if (hashIndex >= 0 && hashIndex < iri.length - 1) {
    return iri.slice(hashIndex + 1);
  }
  const slashIndex = iri.lastIndexOf("/");
  if (slashIndex >= 0 && slashIndex < iri.length - 1) {
    return iri.slice(slashIndex + 1);
  }
  return iri;
}

export function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeComparableToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function preferredOntologyName(properties: Record<string, unknown> | undefined): string | null {
  for (const key of PREFERRED_NAME_KEYS) {
    const value = properties?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function tokenVariants(value: string): string[] {
  const local = iriLocalName(value);
  const baseCandidates = new Set<string>([value, local]);

  const tokens = new Set<string>();
  for (const candidate of baseCandidates) {
    const strict = normalizeToken(candidate);
    const comparable = normalizeComparableToken(candidate);
    if (strict) {
      tokens.add(strict);
    }
    if (comparable) {
      tokens.add(comparable);
    }
  }
  return Array.from(tokens);
}

function registerPropertyAliases(
  labelMap: Map<string, string>,
  aliases: Array<string | undefined>,
  label: string
): void {
  for (const alias of aliases) {
    if (!alias || !alias.trim()) {
      continue;
    }
    const normalized = alias.trim();
    if (!labelMap.has(normalized)) {
      labelMap.set(normalized, label);
    }
  }
}

function scoreStateFieldKey(key: string): number {
  if (normalizeComparableToken(key) === "state") {
    return 0;
  }
  return 99;
}

function toPascalToken(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((token) => token[0]?.toUpperCase() + token.slice(1))
    .join("");
}

function deriveEventTypeFromLocalName(localName: string): string {
  if (localName.startsWith("trans_")) {
    return `${toPascalToken(localName.slice("trans_".length))}Transition`;
  }
  if (localName.startsWith("aout_")) {
    return `${toPascalToken(localName.slice("aout_".length))}Result`;
  }
  if (localName.startsWith("ain_")) {
    return `${toPascalToken(localName.slice("ain_".length))}Command`;
  }
  if (localName.startsWith("sig_")) {
    return toPascalToken(localName.slice("sig_".length));
  }
  if (localName.startsWith("evt_")) {
    return toPascalToken(localName.slice("evt_".length));
  }
  return "";
}

function eventTypeValue(node: OntologyNode): string {
  const canonicalFromField = (value: unknown): string => {
    if (typeof value !== "string") {
      return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    return trimmed.replace(/\s+/g, "");
  };

  const localName = iriLocalName(node.uri);
  const localDerived = deriveEventTypeFromLocalName(localName);
  if (localName.startsWith("trans_") && localDerived) {
    return localDerived;
  }

  const fromProphetName = canonicalFromField(node.properties?.["prophet:name"]);
  if (fromProphetName) {
    return fromProphetName;
  }

  const fromName = canonicalFromField(node.properties?.name);
  if (fromName) {
    return fromName;
  }

  return localDerived || localName;
}

function sortedNodes(graph: OntologyGraph): OntologyNode[] {
  return [...graph.nodes].sort((a, b) => a.uri.localeCompare(b.uri));
}

function sortedEdges(graph: OntologyGraph): OntologyEdge[] {
  return [...graph.edges].sort((a, b) => {
    if (a.fromUri !== b.fromUri) {
      return a.fromUri.localeCompare(b.fromUri);
    }
    if (a.type !== b.type) {
      return a.type.localeCompare(b.type);
    }
    return a.toUri.localeCompare(b.toUri);
  });
}

function buildFieldLabelMapForContainer(
  containerUri: string,
  nodes: OntologyNode[],
  edges: OntologyEdge[],
  nodesByUri: Map<string, OntologyNode>
): Map<string, string> {
  const fieldLabelByKey = new Map<string, string>();

  for (const prop of mapPropertyDefinitions(containerUri, nodes, edges)) {
    const propertyNode = prop.uri ? nodesByUri.get(prop.uri) : undefined;
    const label =
      preferredOntologyName(propertyNode?.properties) ||
      (prop.name && prop.name.trim()) ||
      (prop.fieldKey && prop.fieldKey.trim()) ||
      (prop.uri ? iriLocalName(prop.uri) : "");
    if (!label) {
      continue;
    }
    registerPropertyAliases(
      fieldLabelByKey,
      [prop.fieldKey, prop.name, prop.uri ? iriLocalName(prop.uri) : undefined],
      label
    );
  }

  return fieldLabelByKey;
}

function buildObjectModelDescriptor(
  node: OntologyNode,
  nodes: OntologyNode[],
  edges: OntologyEdge[],
  nodesByUri: Map<string, OntologyNode>
): OntologyDisplayObjectModel {
  const fieldLabelByKey = new Map<string, string>();
  const stateLabelByToken = new Map<string, string>();
  const stateFilterOptionsByValue = new Map<string, string>();
  const canonicalFieldKeys: string[] = [];
  const propertyValueTypeByKey = new Map<string, string>();

  const objectLocalName = iriLocalName(node.uri);
  const objectSlug = objectLocalName.startsWith("obj_")
    ? objectLocalName.slice(4)
    : objectLocalName;

  for (const prop of mapPropertyDefinitions(node.uri, nodes, edges)) {
    const propertyNode = prop.uri ? nodesByUri.get(prop.uri) : undefined;
    const label =
      preferredOntologyName(propertyNode?.properties) ||
      (prop.name && prop.name.trim()) ||
      (prop.fieldKey && prop.fieldKey.trim()) ||
      (prop.uri ? iriLocalName(prop.uri) : "");
    const canonicalKey =
      (prop.fieldKey && prop.fieldKey.trim()) || (prop.uri ? iriLocalName(prop.uri) : "");
    if (!label) {
      continue;
    }
    if (canonicalKey) {
      canonicalFieldKeys.push(canonicalKey);
      if (prop.valueTypeUri) {
        propertyValueTypeByKey.set(canonicalKey, prop.valueTypeUri);
      }
    }
    registerPropertyAliases(
      fieldLabelByKey,
      [prop.fieldKey, prop.name, prop.uri ? iriLocalName(prop.uri) : undefined],
      label
    );
  }

  const stateUris = edges
    .filter((edge) => edge.fromUri === node.uri && edge.type === "hasPossibleState")
    .map((edge) => edge.toUri);
  stateUris.sort((a, b) => a.localeCompare(b));

  for (const stateUri of stateUris) {
    const stateNode = nodesByUri.get(stateUri);
    const stateLocalName = iriLocalName(stateUri);
    const stateName = preferredOntologyName(stateNode?.properties) || stateLocalName;
    const aliases = new Set<string>([stateName, stateLocalName]);
    const scopedPrefix = `state_${objectSlug}_`;
    const stateValue =
      objectSlug && stateLocalName.startsWith(scopedPrefix)
        ? stateLocalName.slice(scopedPrefix.length)
        : stateLocalName.startsWith("state_")
          ? stateLocalName.slice(6)
          : stateLocalName;
    if (stateValue) {
      stateFilterOptionsByValue.set(stateValue, stateName);
      aliases.add(stateValue);
    }
    if (stateLocalName.startsWith("state_")) {
      aliases.add(stateLocalName.slice(6));
    }
    if (objectSlug && stateLocalName.startsWith(scopedPrefix)) {
      aliases.add(stateLocalName.slice(scopedPrefix.length));
    }
    for (const alias of aliases) {
      for (const token of tokenVariants(alias)) {
        if (token && !stateLabelByToken.has(token)) {
          stateLabelByToken.set(token, stateName);
        }
      }
    }
  }

  const stateFieldKeyCandidate = canonicalFieldKeys
    .slice()
    .sort((a, b) => {
      const scoreDiff = scoreStateFieldKey(a) - scoreStateFieldKey(b);
      return scoreDiff !== 0 ? scoreDiff : a.localeCompare(b);
    })[0];
  const stateFilterFieldKey =
    stateFieldKeyCandidate && scoreStateFieldKey(stateFieldKeyCandidate) < 99
      ? stateFieldKeyCandidate
      : null;
  const uniqueCanonicalFieldKeys = Array.from(new Set(canonicalFieldKeys)).sort((a, b) =>
    a.localeCompare(b)
  );

  return {
    uri: node.uri,
    localName: objectLocalName,
    name: preferredOntologyName(node.properties) || objectLocalName,
    fieldLabelByKey,
    canonicalFieldKeys: uniqueCanonicalFieldKeys,
    stateLabelByToken,
    stateFilterFieldKey,
    stateFilterOptions: Array.from(stateFilterOptionsByValue.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    propertyValueTypeByKey,
  };
}

function setLookupIfMissing<T>(lookup: Map<string, T>, tokens: string[], value: T): void {
  for (const token of tokens) {
    if (token && !lookup.has(token)) {
      lookup.set(token, value);
    }
  }
}

function setOwnerLookupIfMissing(
  ownerByUri: Map<string, OntologyDisplayObjectModel>,
  ownerByToken: Map<string, OntologyDisplayObjectModel>,
  conceptUri: string,
  owner: OntologyDisplayObjectModel,
  nodesByUri: Map<string, OntologyNode>
): void {
  if (!conceptUri || !conceptUri.trim()) {
    return;
  }
  if (!ownerByUri.has(conceptUri)) {
    ownerByUri.set(conceptUri, owner);
  }

  const conceptNode = nodesByUri.get(conceptUri);
  const conceptName = preferredOntologyName(conceptNode?.properties);
  const tokenInputs = [conceptUri, iriLocalName(conceptUri)];
  if (conceptName) {
    tokenInputs.push(conceptName);
  }
  setLookupIfMissing(
    ownerByToken,
    tokenInputs.flatMap((value) => tokenVariants(value)),
    owner
  );
}

export function buildOntologyDisplayCatalog(graph: OntologyGraph | null): OntologyDisplayCatalog {
  if (!graph) {
    return {
      objectModels: [],
      objectModelByUri: new Map(),
      objectModelByToken: new Map(),
      stateOwnerObjectByUri: new Map(),
      stateOwnerObjectByToken: new Map(),
      transitionOwnerObjectByUri: new Map(),
      transitionOwnerObjectByToken: new Map(),
      conceptLabelByToken: new Map(),
      conceptFieldLabelsByToken: new Map(),
      globalFieldLabelByKey: new Map(),
      eventTypeLabelByToken: new Map(),
    };
  }

  const nodes = sortedNodes(graph);
  const edges = sortedEdges(graph);
  const nodesByUri = new Map(nodes.map((node) => [node.uri, node]));

  const objectModels = nodes
    .filter((node) => node.label === "ObjectModel")
    .map((node) => buildObjectModelDescriptor(node, nodes, edges, nodesByUri));

  const objectModelByUri = new Map(objectModels.map((model) => [model.uri, model]));
  const objectModelByToken = new Map<string, OntologyDisplayObjectModel>();
  for (const model of objectModels) {
    setLookupIfMissing(
      objectModelByToken,
      tokenVariants(model.uri)
        .concat(tokenVariants(model.name))
        .concat(tokenVariants(model.localName)),
      model
    );
  }

  const stateOwnerObjectByUri = new Map<string, OntologyDisplayObjectModel>();
  const stateOwnerObjectByToken = new Map<string, OntologyDisplayObjectModel>();
  const transitionOwnerObjectByUri = new Map<string, OntologyDisplayObjectModel>();
  const transitionOwnerObjectByToken = new Map<string, OntologyDisplayObjectModel>();

  for (const edge of edges) {
    if (edge.type === "hasPossibleState") {
      const owner = objectModelByUri.get(edge.fromUri);
      if (owner) {
        setOwnerLookupIfMissing(
          stateOwnerObjectByUri,
          stateOwnerObjectByToken,
          edge.toUri,
          owner,
          nodesByUri
        );
      }
      continue;
    }
    if (edge.type === "isStateOf") {
      const owner = objectModelByUri.get(edge.toUri);
      if (owner) {
        setOwnerLookupIfMissing(
          stateOwnerObjectByUri,
          stateOwnerObjectByToken,
          edge.fromUri,
          owner,
          nodesByUri
        );
      }
      continue;
    }
    if (edge.type === "transitionOf") {
      const owner = objectModelByUri.get(edge.toUri);
      if (owner) {
        setOwnerLookupIfMissing(
          transitionOwnerObjectByUri,
          transitionOwnerObjectByToken,
          edge.fromUri,
          owner,
          nodesByUri
        );
      }
      continue;
    }
    if (edge.type === "hasPossibleTransition") {
      const owner = objectModelByUri.get(edge.fromUri);
      if (owner) {
        setOwnerLookupIfMissing(
          transitionOwnerObjectByUri,
          transitionOwnerObjectByToken,
          edge.toUri,
          owner,
          nodesByUri
        );
      }
    }
  }

  const inferredTransitionOwners = new Map<string, OntologyDisplayObjectModel>();
  const ambiguousTransitionUris = new Set<string>();
  for (const edge of edges) {
    if (edge.type !== "fromState" && edge.type !== "toState") {
      continue;
    }
    if (transitionOwnerObjectByUri.has(edge.fromUri)) {
      continue;
    }
    const owner = stateOwnerObjectByUri.get(edge.toUri);
    if (!owner) {
      continue;
    }
    const currentOwner = inferredTransitionOwners.get(edge.fromUri);
    if (!currentOwner) {
      inferredTransitionOwners.set(edge.fromUri, owner);
      continue;
    }
    if (currentOwner.uri !== owner.uri) {
      ambiguousTransitionUris.add(edge.fromUri);
    }
  }
  for (const [transitionUri, owner] of inferredTransitionOwners.entries()) {
    if (ambiguousTransitionUris.has(transitionUri)) {
      continue;
    }
    setOwnerLookupIfMissing(
      transitionOwnerObjectByUri,
      transitionOwnerObjectByToken,
      transitionUri,
      owner,
      nodesByUri
    );
  }

  const conceptLabelByToken = new Map<string, string>();
  const conceptFieldLabelsByToken = new Map<string, Map<string, string>>();
  const globalFieldLabelByKey = new Map<string, string>();
  const eventTypeLabelByToken = new Map<string, string>();

  for (const node of nodes) {
    const displayName = preferredOntologyName(node.properties) || iriLocalName(node.uri);
    const keys: string[] = [node.uri, displayName, iriLocalName(node.uri)];
    for (const value of Object.values(node.properties || {})) {
      if (typeof value === "string") {
        keys.push(value);
      } else if (Array.isArray(value)) {
        value.forEach((item) => {
          if (typeof item === "string") {
            keys.push(item);
          }
        });
      }
    }
    setLookupIfMissing(
      conceptLabelByToken,
      keys.flatMap((key) => tokenVariants(key)),
      displayName
    );

    const fieldLabels = buildFieldLabelMapForContainer(node.uri, nodes, edges, nodesByUri);
    for (const [key, label] of fieldLabels.entries()) {
      if (!globalFieldLabelByKey.has(key)) {
        globalFieldLabelByKey.set(key, label);
      }
    }
    if (fieldLabels.size > 0) {
      const conceptKeys = [node.uri, iriLocalName(node.uri)];
      const preferredName = preferredOntologyName(node.properties);
      if (preferredName) {
        conceptKeys.push(preferredName);
      }
      setLookupIfMissing(
        conceptFieldLabelsByToken,
        conceptKeys.flatMap((key) => tokenVariants(key)),
        fieldLabels
      );
    }

    if (EVENT_NODE_LABELS.has(node.label)) {
      const eventKeys = [node.uri, iriLocalName(node.uri), eventTypeValue(node)];
      setLookupIfMissing(
        eventTypeLabelByToken,
        eventKeys.flatMap((key) => tokenVariants(key)),
        displayName
      );
    }
  }

  return {
    objectModels,
    objectModelByUri,
    objectModelByToken,
    stateOwnerObjectByUri,
    stateOwnerObjectByToken,
    transitionOwnerObjectByUri,
    transitionOwnerObjectByToken,
    conceptLabelByToken,
    conceptFieldLabelsByToken,
    globalFieldLabelByKey,
    eventTypeLabelByToken,
  };
}
