'use client';

import { useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { Card } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import type { OntologyEdge, OntologyGraph, OntologyNode } from '@/app/types/ontology';
import { OntologyGraphVisualization } from './ontology-graph';
import { Search, Network, Activity, ArrowRightLeft } from 'lucide-react';

interface OntologyExplorerTabsProps {
  graphData: OntologyGraph;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  initialConceptUri?: string | null;
}

type ExplorerTab = 'overview' | 'objects' | 'actions' | 'events' | 'triggers';
type RelationshipScope = 'structure' | 'lifecycle' | 'automation' | 'reference';
type RelationshipFilters = Record<RelationshipScope, boolean>;

const MAX_GRAPH_RENDER_NODES = 220;
const MAX_GRAPH_RENDER_EDGES = 520;

const RELATIONSHIP_SCOPE_LABEL: Record<RelationshipScope, string> = {
  structure: 'Structure',
  lifecycle: 'Lifecycle',
  automation: 'Automation',
  reference: 'Reference',
};

const TAB_CONFIG: Record<ExplorerTab, { title: string; labels: string[] }> = {
  overview: {
    title: 'Ecosystem',
    labels: [
      'ObjectModel',
      'State',
      'Action',
      'Process',
      'Workflow',
      'Signal',
      'Transition',
      'EventTrigger',
    ],
  },
  objects: {
    title: 'Object Lifecycles',
    labels: ['ObjectModel', 'State', 'Transition'],
  },
  actions: {
    title: 'Action Contracts',
    labels: ['Action', 'Process', 'Workflow', 'Signal', 'Transition'],
  },
  events: {
    title: 'Event Semantics',
    labels: ['Signal', 'Transition', 'EventTrigger'],
  },
  triggers: {
    title: 'Trigger Network',
    labels: ['EventTrigger', 'Signal', 'Transition', 'Action', 'Process', 'Workflow'],
  },
};

function toSearchText(node: OntologyNode) {
  const props = node.properties ?? {};
  const name = typeof props.name === 'string' ? props.name : '';
  const description = typeof props.description === 'string' ? props.description : '';
  return `${node.uri} ${node.label} ${name} ${description}`.toLowerCase();
}

function displayName(node: OntologyNode) {
  const raw = node.properties?.name;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : node.uri;
}

function isStandardTypeNode(node: OntologyNode) {
  if (node.label === 'BaseType') {
    return true;
  }
  const uri = node.uri.toLowerCase();
  return (
    uri.startsWith('std:') ||
    uri.includes('/std#') ||
    uri.includes('/std/') ||
    uri.includes('urn:prophet:std')
  );
}

function isAuthoringConceptNode(node: OntologyNode) {
  return [
    'ObjectModel',
    'State',
    'Transition',
    'Action',
    'Process',
    'Workflow',
    'Signal',
    'EventTrigger',
  ].includes(node.label);
}

function relatedEdges(edges: OntologyEdge[], nodeUri: string) {
  const outgoing = edges.filter((edge) => edge.fromUri === nodeUri);
  const incoming = edges.filter((edge) => edge.toUri === nodeUri);
  return { outgoing, incoming };
}

function relationshipScopeForEdge(edgeType: string): RelationshipScope {
  if (
    ['hasPossibleState', 'initialState', 'transitionOf', 'fromState', 'toState', 'isStateOf'].includes(edgeType)
  ) {
    return 'lifecycle';
  }
  if (['listensTo', 'invokes', 'eventTrigger', 'producesEvent'].includes(edgeType)) {
    return 'automation';
  }
  if (edgeType === 'referencesObjectModel') {
    return 'reference';
  }
  return 'structure';
}

function applyGraphControls(
  graph: OntologyGraph,
  relationshipFilters: RelationshipFilters,
  selectedUri: string | null,
  focusNeighborhoodOnly: boolean
): OntologyGraph {
  const enabledEdges = graph.edges.filter((edge) => relationshipFilters[relationshipScopeForEdge(edge.type)]);

  if (focusNeighborhoodOnly && selectedUri) {
    const focusedEdges = enabledEdges.filter(
      (edge) => edge.fromUri === selectedUri || edge.toUri === selectedUri
    );
    const focusedUris = new Set<string>([selectedUri]);
    focusedEdges.forEach((edge) => {
      focusedUris.add(edge.fromUri);
      focusedUris.add(edge.toUri);
    });
    return {
      nodes: graph.nodes.filter((node) => focusedUris.has(node.uri)),
      edges: focusedEdges,
    };
  }

  return {
    nodes: graph.nodes,
    edges: enabledEdges,
  };
}

function buildVisibleGraph(
  graphData: OntologyGraph,
  labels: Set<string>,
  query: string
): OntologyGraph {
  const baseNodes = graphData.nodes.filter(
    (node) => labels.has(node.label) && isAuthoringConceptNode(node) && !isStandardTypeNode(node)
  );
  if (!query.trim()) {
    const baseUris = new Set(baseNodes.map((node) => node.uri));
    const edges = buildVisibleEdges(graphData, baseUris);
    return { nodes: baseNodes, edges };
  }

  const queryLower = query.toLowerCase();
  const matched = baseNodes.filter((node) => toSearchText(node).includes(queryLower));
  const visibleUris = new Set(matched.map((node) => node.uri));

  // Keep one-hop neighborhood for context around matched concepts.
  for (const edge of graphData.edges) {
    if (visibleUris.has(edge.fromUri) || visibleUris.has(edge.toUri)) {
      visibleUris.add(edge.fromUri);
      visibleUris.add(edge.toUri);
    }
  }

  const baseUris = new Set(baseNodes.map((node) => node.uri));
  const derivedReferenceEdges = deriveAuthoringReferenceEdges(graphData, baseUris);
  for (const edge of derivedReferenceEdges) {
    if (visibleUris.has(edge.fromUri) || visibleUris.has(edge.toUri)) {
      visibleUris.add(edge.fromUri);
      visibleUris.add(edge.toUri);
    }
  }

  const nodes = graphData.nodes.filter(
    (node) =>
      visibleUris.has(node.uri) &&
      labels.has(node.label) &&
      isAuthoringConceptNode(node) &&
      !isStandardTypeNode(node)
  );
  const nodeUris = new Set(nodes.map((node) => node.uri));
  const edges = buildVisibleEdges(graphData, nodeUris);
  return { nodes, edges };
}

function buildVisibleEdges(graphData: OntologyGraph, nodeUris: Set<string>): OntologyEdge[] {
  const directEdges = graphData.edges
    .filter(
    (edge) => nodeUris.has(edge.fromUri) && nodeUris.has(edge.toUri)
    )
    .map(normalizeViewerEdgeDirection);
  const derivedReferences = deriveAuthoringReferenceEdges(graphData, nodeUris);
  const merged = [...directEdges, ...derivedReferences];
  const deduped = new Map<string, OntologyEdge>();
  for (const edge of merged) {
    deduped.set(`${edge.fromUri}|${edge.type}|${edge.toUri}`, edge);
  }
  return Array.from(deduped.values());
}

function deriveAuthoringReferenceEdges(graphData: OntologyGraph, nodeUris: Set<string>): OntologyEdge[] {
  const nodeByUri = new Map(graphData.nodes.map((node) => [node.uri, node]));
  const outgoing = new Map<string, Map<string, string[]>>();

  for (const edge of graphData.edges) {
    if (!outgoing.has(edge.fromUri)) {
      outgoing.set(edge.fromUri, new Map());
    }
    const byType = outgoing.get(edge.fromUri)!;
    if (!byType.has(edge.type)) {
      byType.set(edge.type, []);
    }
    byType.get(edge.type)!.push(edge.toUri);
  }

  const next = (fromUri: string, edgeType: string) => outgoing.get(fromUri)?.get(edgeType) ?? [];

  const referenceTargetsByRefNode = new Map<string, string[]>();
  for (const edge of graphData.edges) {
    if (edge.type !== 'referencesObjectModel') {
      continue;
    }
    const refNode = nodeByUri.get(edge.fromUri);
    if (!refNode || refNode.label !== 'ObjectReference') {
      continue;
    }
    if (!referenceTargetsByRefNode.has(edge.fromUri)) {
      referenceTargetsByRefNode.set(edge.fromUri, []);
    }
    referenceTargetsByRefNode.get(edge.fromUri)!.push(edge.toUri);
  }

  const cache = new Map<string, Set<string>>();
  const collectReferenceTargets = (startUri: string): Set<string> => {
    if (cache.has(startUri)) {
      return cache.get(startUri)!;
    }

    const result = new Set<string>();
    const queue: Array<{ uri: string; depth: number }> = [{ uri: startUri, depth: 0 }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.uri)) {
        continue;
      }
      visited.add(current.uri);

      const directTargets = referenceTargetsByRefNode.get(current.uri) ?? [];
      directTargets.forEach((target) => result.add(target));

      if (current.depth >= 4) {
        continue;
      }
      for (const toUri of next(current.uri, 'valueType')) {
        queue.push({ uri: toUri, depth: current.depth + 1 });
      }
      for (const toUri of next(current.uri, 'itemType')) {
        queue.push({ uri: toUri, depth: current.depth + 1 });
      }
    }

    cache.set(startUri, result);
    return result;
  };

  const derived = new Map<string, OntologyEdge>();
  for (const sourceUri of nodeUris) {
    const sourceNode = nodeByUri.get(sourceUri);
    if (!sourceNode || !isAuthoringConceptNode(sourceNode)) {
      continue;
    }

    const propertyContainerUris = new Set<string>([sourceUri]);
    if (['Action', 'Process', 'Workflow'].includes(sourceNode.label)) {
      next(sourceUri, 'acceptsInput').forEach((inputUri) => propertyContainerUris.add(inputUri));
    }

    for (const containerUri of propertyContainerUris) {
      for (const propertyUri of next(containerUri, 'hasProperty')) {
        const targets = collectReferenceTargets(propertyUri);
        for (const targetUri of targets) {
          if (!nodeUris.has(targetUri) || targetUri === sourceUri) {
            continue;
          }
          const key = `${sourceUri}|referencesObjectModel|${targetUri}`;
          derived.set(key, {
            fromUri: sourceUri,
            toUri: targetUri,
            type: 'referencesObjectModel',
          });
        }
      }
    }
  }

  return Array.from(derived.values());
}

function normalizeViewerEdgeDirection(edge: OntologyEdge): OntologyEdge {
  if (edge.type === 'fromState') {
    return {
      fromUri: edge.toUri,
      toUri: edge.fromUri,
      type: edge.type,
    };
  }
  return edge;
}

function limitGraphForPerformance(
  graph: OntologyGraph,
  selectedUri: string | null
): { graph: OntologyGraph; truncated: boolean; hiddenNodes: number; hiddenEdges: number } {
  if (graph.nodes.length <= MAX_GRAPH_RENDER_NODES && graph.edges.length <= MAX_GRAPH_RENDER_EDGES) {
    return { graph, truncated: false, hiddenNodes: 0, hiddenEdges: 0 };
  }

  const adjacency = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.fromUri)) {
      adjacency.set(edge.fromUri, new Set());
    }
    if (!adjacency.has(edge.toUri)) {
      adjacency.set(edge.toUri, new Set());
    }
    adjacency.get(edge.fromUri)?.add(edge.toUri);
    adjacency.get(edge.toUri)?.add(edge.fromUri);
  }

  const seed = selectedUri && graph.nodes.some((node) => node.uri === selectedUri)
    ? selectedUri
    : graph.nodes[0]?.uri ?? null;
  const selected = new Set<string>();
  const queue: string[] = [];

  if (seed) {
    selected.add(seed);
    queue.push(seed);
  }

  while (queue.length > 0 && selected.size < MAX_GRAPH_RENDER_NODES) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const neighbors = adjacency.get(current);
    if (!neighbors) {
      continue;
    }
    for (const neighbor of neighbors) {
      if (selected.size >= MAX_GRAPH_RENDER_NODES) {
        break;
      }
      if (!selected.has(neighbor)) {
        selected.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  if (selected.size === 0) {
    graph.nodes.slice(0, MAX_GRAPH_RENDER_NODES).forEach((node) => selected.add(node.uri));
  }

  const boundedNodes = graph.nodes.filter((node) => selected.has(node.uri));
  let boundedEdges = graph.edges.filter(
    (edge) => selected.has(edge.fromUri) && selected.has(edge.toUri)
  );
  if (boundedEdges.length > MAX_GRAPH_RENDER_EDGES) {
    boundedEdges = boundedEdges.slice(0, MAX_GRAPH_RENDER_EDGES);
  }

  return {
    graph: { nodes: boundedNodes, edges: boundedEdges },
    truncated: true,
    hiddenNodes: Math.max(0, graph.nodes.length - boundedNodes.length),
    hiddenEdges: Math.max(0, graph.edges.length - boundedEdges.length),
  };
}

export function OntologyExplorerTabs({
  graphData,
  activeTab,
  onTabChange,
  initialConceptUri,
}: OntologyExplorerTabsProps) {
  const [internalTab, setInternalTab] = useState<ExplorerTab>('overview');
  const [query, setQuery] = useState('');
  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  const [relationshipFilters, setRelationshipFilters] = useState<RelationshipFilters>({
    structure: true,
    lifecycle: true,
    automation: true,
    reference: true,
  });
  const [focusNeighborhoodOnly, setFocusNeighborhoodOnly] = useState(false);

  const currentTab = (activeTab || internalTab || 'overview') as ExplorerTab;
  const tabConfig = TAB_CONFIG[currentTab] || TAB_CONFIG.overview;

  const handleTabChange = (value: string) => {
    setQuery('');
    setSelectedUri(null);
    setFocusNeighborhoodOnly(true);
    setRelationshipFilters({
      structure: true,
      lifecycle: true,
      automation: true,
      reference: true,
    });
    if (onTabChange) {
      onTabChange(value);
      return;
    }
    if (value in TAB_CONFIG) {
      setInternalTab(value as ExplorerTab);
    }
  };

  const allowedLabels = useMemo(() => new Set(tabConfig.labels), [tabConfig.labels]);

  const scopedGraph = useMemo(
    () => buildVisibleGraph(graphData, allowedLabels, query),
    [graphData, allowedLabels, query]
  );

  const relationshipScopeCounts = useMemo(() => {
    const counts: Record<RelationshipScope, number> = {
      structure: 0,
      lifecycle: 0,
      automation: 0,
      reference: 0,
    };
    for (const edge of scopedGraph.edges) {
      counts[relationshipScopeForEdge(edge.type)] += 1;
    }
    return counts;
  }, [scopedGraph.edges]);

  const sortedCatalog = useMemo(() => {
    const nodes = graphData.nodes.filter(
      (node) => allowedLabels.has(node.label) && isAuthoringConceptNode(node) && !isStandardTypeNode(node)
    );
    const queryLower = query.trim().toLowerCase();
    const filtered = queryLower.length > 0
      ? nodes.filter((node) => toSearchText(node).includes(queryLower))
      : nodes;
    return filtered.slice().sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }, [graphData.nodes, allowedLabels, query]);

  const deepLinkedUri =
    initialConceptUri && scopedGraph.nodes.some((node) => node.uri === initialConceptUri)
      ? initialConceptUri
      : null;
  const effectiveSelectedUri = selectedUri || deepLinkedUri || sortedCatalog[0]?.uri || null;

  const visibleGraph = useMemo(
    () => applyGraphControls(scopedGraph, relationshipFilters, effectiveSelectedUri, focusNeighborhoodOnly),
    [effectiveSelectedUri, focusNeighborhoodOnly, relationshipFilters, scopedGraph]
  );

  const mapGraphState = useMemo(
    () => limitGraphForPerformance(visibleGraph, effectiveSelectedUri),
    [visibleGraph, effectiveSelectedUri]
  );

  const visibleLabelSet = useMemo(
    () => Array.from(new Set(mapGraphState.graph.nodes.map((node) => node.label))),
    [mapGraphState.graph.nodes]
  );

  const selectedNode = useMemo(
    () => scopedGraph.nodes.find((node) => node.uri === effectiveSelectedUri) || null,
    [scopedGraph.nodes, effectiveSelectedUri]
  );

  const selectedRelations = useMemo(() => {
    if (!selectedNode) {
      return { outgoing: [], incoming: [] } as {
        outgoing: OntologyEdge[];
        incoming: OntologyEdge[];
      };
    }
    return relatedEdges(visibleGraph.edges, selectedNode.uri);
  }, [visibleGraph.edges, selectedNode]);

  const allLabelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of scopedGraph.nodes) {
      counts.set(node.label, (counts.get(node.label) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [scopedGraph.nodes]);

  const renderCatalog = () => (
    <Card className="h-full rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base">Concept Catalog</h3>
        <Badge variant="secondary">{sortedCatalog.length}</Badge>
      </div>
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, label, or description..."
          className="pl-9"
        />
      </div>
      <div className="mt-3 h-[440px] space-y-2 overflow-y-auto pr-1">
        {sortedCatalog.map((node) => {
          const isSelected = node.uri === effectiveSelectedUri;
          return (
            <Button
              key={node.uri}
              variant={isSelected ? 'secondary' : 'ghost'}
              className="h-auto w-full justify-start px-3 py-2 text-left"
              onClick={() => setSelectedUri(node.uri)}
            >
              <div className="w-full">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{displayName(node)}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {node.label}
                  </Badge>
                </div>
              </div>
            </Button>
          );
        })}
        {sortedCatalog.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            No concepts match this filter.
          </div>
        )}
      </div>
    </Card>
  );

  const renderInspector = () => (
    <Card className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base">Concept Inspector</h3>
        {selectedNode && <Badge variant="secondary">{selectedNode.label}</Badge>}
      </div>
      {!selectedNode && (
        <p className="mt-3 text-sm text-muted-foreground">
          Select a concept to inspect its schema and graph relationships.
        </p>
      )}
      {selectedNode && (
        <div className="mt-3 space-y-4">
          <div>
            <p className="font-display text-lg">{displayName(selectedNode)}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">{selectedNode.uri}</p>
            {typeof selectedNode.properties.description === 'string' && (
              <p className="mt-2 text-sm text-muted-foreground">{selectedNode.properties.description}</p>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Outgoing</p>
              <div className="mt-2 space-y-2">
                {selectedRelations.outgoing.slice(0, 10).map((edge, index) => (
                  <button
                    key={`${edge.fromUri}-${edge.type}-${edge.toUri}-${index}`}
                    onClick={() => setSelectedUri(edge.toUri)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-accent"
                  >
                    <span className="truncate text-xs">{edge.type}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {displayName(graphData.nodes.find((node) => node.uri === edge.toUri) || { uri: edge.toUri, label: '', properties: {} })}
                    </span>
                  </button>
                ))}
                {selectedRelations.outgoing.length === 0 && (
                  <p className="text-xs text-muted-foreground">No outgoing relationships.</p>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Incoming</p>
              <div className="mt-2 space-y-2">
                {selectedRelations.incoming.slice(0, 10).map((edge, index) => (
                  <button
                    key={`${edge.fromUri}-${edge.type}-${edge.toUri}-${index}`}
                    onClick={() => setSelectedUri(edge.fromUri)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-accent"
                  >
                    <span className="truncate text-xs">{edge.type}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {displayName(graphData.nodes.find((node) => node.uri === edge.fromUri) || { uri: edge.fromUri, label: '', properties: {} })}
                    </span>
                  </button>
                ))}
                {selectedRelations.incoming.length === 0 && (
                  <p className="text-xs text-muted-foreground">No incoming relationships.</p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-background/70 p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Schema Fields</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(selectedNode.properties || {}).map(([key, value]) => (
                <Badge key={key} variant="outline" className="max-w-full">
                  <span className="mr-1 text-muted-foreground">{key}:</span>
                  <span className="truncate">{String(value)}</span>
                </Badge>
              ))}
              {Object.keys(selectedNode.properties || {}).length === 0 && (
                <p className="text-xs text-muted-foreground">No scalar fields on this concept.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );

  return (
    <Tabs value={currentTab} onValueChange={handleTabChange} className="flex flex-col gap-4">
      <Card className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="h-11">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="objects">Objects</TabsTrigger>
            <TabsTrigger value="actions">Actions</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="triggers">Triggers</TabsTrigger>
          </TabsList>
        </div>
      </Card>

      {(Object.keys(TAB_CONFIG) as ExplorerTab[]).map((tab) => (
        <TabsContent key={tab} value={tab} className="m-0">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Card className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Scope</p>
                <p className="mt-2 font-display text-2xl">{tabConfig.title}</p>
              </Card>
              <Card className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Concepts</p>
                <p className="mt-2 font-display text-2xl">{scopedGraph.nodes.length}</p>
              </Card>
              <Card className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Relationships</p>
                <p className="mt-2 font-display text-2xl">{visibleGraph.edges.length}</p>
              </Card>
              <Card className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Most Common Label</p>
                <p className="mt-2 font-display text-xl">
                  {allLabelCounts[0]?.[0] || 'N/A'} <span className="text-sm text-muted-foreground">({allLabelCounts[0]?.[1] || 0})</span>
                </p>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
              {renderCatalog()}
              <div className="space-y-4">
              <Card className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="font-display text-base">Ontology Map</h3>
                    <p className="text-xs text-muted-foreground">
                        Click a node to inspect it. Use scopes and focus mode to reduce graph noise.
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Network className="h-4 w-4" />
                      <span>{visibleLabelSet.length} labels</span>
                    </div>
                  </div>
                  {mapGraphState.truncated && (
                    <div className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      Large ontology detected. Map is showing a bounded neighborhood view
                      (hidden: {mapGraphState.hiddenNodes} nodes, {mapGraphState.hiddenEdges} edges).
                      Use search or move focus to inspect more areas.
                    </div>
                  )}
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {(Object.keys(RELATIONSHIP_SCOPE_LABEL) as RelationshipScope[]).map((scope) => (
                      <Button
                        key={scope}
                        variant={relationshipFilters[scope] ? 'secondary' : 'outline'}
                        size="sm"
                        className="h-8"
                        onClick={() =>
                          setRelationshipFilters((prev) => ({
                            ...prev,
                            [scope]: !prev[scope],
                          }))
                        }
                      >
                        {RELATIONSHIP_SCOPE_LABEL[scope]} ({relationshipScopeCounts[scope]})
                      </Button>
                    ))}
                    <Button
                      variant={focusNeighborhoodOnly ? 'secondary' : 'outline'}
                      size="sm"
                      className="h-8"
                      onClick={() => setFocusNeighborhoodOnly((prev) => !prev)}
                      disabled={!effectiveSelectedUri}
                    >
                      Focus Selection
                    </Button>
                  </div>
                  <div className="h-[640px] xl:h-[720px]">
                    <OntologyGraphVisualization
                      data={mapGraphState.graph}
                      allowedLabels={visibleLabelSet}
                      onNodeSelect={(nodeUri) => setSelectedUri(nodeUri)}
                    />
                  </div>
                </Card>
                <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
                  {renderInspector()}
                  <Card className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                      <h3 className="font-display text-base">Label Distribution</h3>
                    </div>
                    <div className="mt-3 space-y-2">
                      {allLabelCounts.slice(0, 12).map(([label, count]) => (
                        <div key={label} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                          <span className="text-sm">{label}</span>
                          <Badge variant="secondary">{count}</Badge>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <ArrowRightLeft className="h-3.5 w-3.5" />
                        <span>Inspect concept relationships, schema fields, and lifecycle connections across the ontology.</span>
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
