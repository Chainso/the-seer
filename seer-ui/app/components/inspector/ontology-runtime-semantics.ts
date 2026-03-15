import { buildReferenceEdges } from "@/app/components/ontology/graph-reference-edges";
import type { OntologyGraph, OntologyNode } from "@/app/types/ontology";

export const LIVE_EVENT_NODE_LABELS = new Set(["Event"]);
export const LIVE_ACTION_NODE_LABELS = new Set(["Action"]);

export interface RuntimeOutcomeOption {
  value: string;
  label: string;
  source: "Event";
}

function buildGraphContext(graph: OntologyGraph) {
  const nodeByUri = new Map(graph.nodes.map((node) => [node.uri, node]));
  const allEdges = [...graph.edges, ...buildReferenceEdges(graph.nodes, graph.edges)];
  return { nodeByUri, allEdges };
}

function addEventModelLink(
  eventToModels: Map<string, Set<string>>,
  nodeByUri: Map<string, OntologyNode>,
  eventUri: string,
  modelUri: string,
  knownModelUris: Set<string>
): void {
  const eventNode = nodeByUri.get(eventUri);
  if (!eventNode || !LIVE_EVENT_NODE_LABELS.has(eventNode.label) || !knownModelUris.has(modelUri)) {
    return;
  }
  const models = eventToModels.get(eventUri);
  if (models) {
    models.add(modelUri);
    return;
  }
  eventToModels.set(eventUri, new Set([modelUri]));
}

export function buildRuntimeOutcomeOptions(options: {
  graph: OntologyGraph | null;
  anchorModelUri: string;
  displayEventType: (eventType: string) => string;
}): RuntimeOutcomeOption[] {
  const { graph, anchorModelUri, displayEventType } = options;
  if (!graph || !anchorModelUri) {
    return [];
  }

  const { nodeByUri, allEdges } = buildGraphContext(graph);
  const candidateUris = new Set<string>();
  const actionUrisForModel = new Set<string>();

  allEdges.forEach((edge) => {
    if (edge.type !== "referencesObjectModel" || edge.toUri !== anchorModelUri) {
      return;
    }
    const source = nodeByUri.get(edge.fromUri);
    if (!source) {
      return;
    }
    if (LIVE_EVENT_NODE_LABELS.has(source.label)) {
      candidateUris.add(source.uri);
      return;
    }
    if (LIVE_ACTION_NODE_LABELS.has(source.label)) {
      actionUrisForModel.add(source.uri);
    }
  });

  allEdges.forEach((edge) => {
    if (edge.type !== "producesEvent" || !actionUrisForModel.has(edge.fromUri)) {
      return;
    }
    const eventNode = nodeByUri.get(edge.toUri);
    if (eventNode && LIVE_EVENT_NODE_LABELS.has(eventNode.label)) {
      candidateUris.add(edge.toUri);
    }
  });

  return Array.from(candidateUris)
    .map((uri) => ({
      value: uri,
      label: displayEventType(uri),
      source: "Event" as const,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function resolveRuntimeDepthScopedModels(options: {
  anchorModelUri: string;
  depth: number;
  graph: OntologyGraph | null;
  knownModelUris: Set<string>;
}): string[] {
  const { anchorModelUri, depth, graph, knownModelUris } = options;
  if (!anchorModelUri) {
    return [];
  }
  if (!graph || depth <= 1) {
    return [anchorModelUri];
  }

  const { nodeByUri, allEdges } = buildGraphContext(graph);
  const eventToModels = new Map<string, Set<string>>();
  const actionToModels = new Map<string, Set<string>>();
  const actionToProducedEvents = new Map<string, Set<string>>();

  allEdges.forEach((edge) => {
    if (edge.type === "referencesObjectModel") {
      const sourceNode = nodeByUri.get(edge.fromUri);
      if (!sourceNode) {
        return;
      }
      if (LIVE_EVENT_NODE_LABELS.has(sourceNode.label)) {
        addEventModelLink(eventToModels, nodeByUri, edge.fromUri, edge.toUri, knownModelUris);
        return;
      }
      if (LIVE_ACTION_NODE_LABELS.has(sourceNode.label) && knownModelUris.has(edge.toUri)) {
        const models = actionToModels.get(edge.fromUri);
        if (models) {
          models.add(edge.toUri);
          return;
        }
        actionToModels.set(edge.fromUri, new Set([edge.toUri]));
      }
      return;
    }

    if (edge.type !== "producesEvent") {
      return;
    }
    const sourceNode = nodeByUri.get(edge.fromUri);
    const targetNode = nodeByUri.get(edge.toUri);
    if (
      !sourceNode ||
      !targetNode ||
      !LIVE_ACTION_NODE_LABELS.has(sourceNode.label) ||
      !LIVE_EVENT_NODE_LABELS.has(targetNode.label)
    ) {
      return;
    }
    const produced = actionToProducedEvents.get(edge.fromUri);
    if (produced) {
      produced.add(edge.toUri);
      return;
    }
    actionToProducedEvents.set(edge.fromUri, new Set([edge.toUri]));
  });

  actionToModels.forEach((modelUris, actionUri) => {
    const producedEvents = actionToProducedEvents.get(actionUri);
    if (!producedEvents || producedEvents.size === 0) {
      return;
    }
    producedEvents.forEach((eventUri) => {
      modelUris.forEach((modelUri) => {
        addEventModelLink(eventToModels, nodeByUri, eventUri, modelUri, knownModelUris);
      });
    });
  });

  const adjacency = new Map<string, Set<string>>();
  eventToModels.forEach((models) => {
    const scopedModels = [...models];
    scopedModels.forEach((sourceModel) => {
      const neighbors = adjacency.get(sourceModel) ?? new Set<string>();
      scopedModels.forEach((targetModel) => {
        if (targetModel !== sourceModel) {
          neighbors.add(targetModel);
        }
      });
      adjacency.set(sourceModel, neighbors);
    });
  });

  const included = new Set<string>([anchorModelUri]);
  let frontier = new Set<string>([anchorModelUri]);

  for (let layer = 2; layer <= depth; layer += 1) {
    const nextFrontier = new Set<string>();
    frontier.forEach((model) => {
      adjacency.get(model)?.forEach((neighbor) => {
        if (!included.has(neighbor)) {
          included.add(neighbor);
          nextFrontier.add(neighbor);
        }
      });
    });
    if (nextFrontier.size === 0) {
      break;
    }
    frontier = nextFrontier;
  }

  return [anchorModelUri, ...Array.from(included).filter((uri) => uri !== anchorModelUri).sort()];
}
