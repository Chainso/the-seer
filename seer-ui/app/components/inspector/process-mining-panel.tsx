"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Filter, Layers } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

import { getOcpnGraph } from "@/app/lib/api/process-mining";
import { getOntologyGraph } from "@/app/lib/api/ontology";
import type { OcpnGraph } from "@/app/types/process-mining";
import type { OntologyGraph, OntologyNode } from "@/app/types/ontology";
import { OcpnGraph as OcpnGraphView } from "./ocpn-graph";
import { BpmnGraph as BpmnGraphView } from "./bpmn-graph";

type ProcessTreeNode = {
  id: string;
  operator: string | null;
  label: string | null;
  children: ProcessTreeNode[];
};

type BpmnNode = {
  id: string;
  name: string;
  type: string | null;
  incoming: Record<string, unknown>;
  outgoing: Record<string, unknown>;
  level?: number;
};

type BpmnEdge = {
  id: string;
  source: BpmnNode;
  target: BpmnNode;
};

type BpmnGraph = {
  nodes: Record<string, BpmnNode>;
  edges: Record<string, BpmnEdge>;
  getOrderedNodesAndEdges?: () => {
    nodesId: string[];
    edgesId: [string, string][];
    invMap: Record<string, string>;
  };
};

type Pm4jsGlobal = typeof globalThis & {
  __pm4jsReady?: boolean;
  global?: typeof globalThis;
  FrequencyDfg?: new (
    activities: Record<string, number>,
    startActivities: Record<string, number>,
    endActivities: Record<string, number>,
    pathsFrequency: Record<string, number>
  ) => unknown;
  InductiveMiner?: { applyDfg: (dfg: unknown, threshold?: number, removeNoise?: boolean) => ProcessTreeNode };
  ProcessTreeToPetriNetConverter?: { apply: (tree: ProcessTreeNode) => unknown };
  WfNetToBpmnConverter?: { apply: (net: unknown) => BpmnGraph };
};

const iriLocalName = (value: string): string => {
  const hashIndex = value.lastIndexOf("#");
  if (hashIndex >= 0 && hashIndex < value.length - 1) {
    return value.slice(hashIndex + 1);
  }
  const slashIndex = value.lastIndexOf("/");
  if (slashIndex >= 0 && slashIndex < value.length - 1) {
    return value.slice(slashIndex + 1);
  }
  return value;
};

const ontologyNodeName = (node: OntologyNode): string => {
  const prophetName = node.properties?.["prophet:name"];
  if (typeof prophetName === "string" && prophetName.trim()) {
    return prophetName.trim();
  }
  const name = node.properties?.name;
  if (typeof name === "string" && name.trim()) {
    return name.trim();
  }
  return iriLocalName(node.uri);
};

const ensurePm4js = async (): Promise<Pm4jsGlobal> => {
  const globalRef = globalThis as Pm4jsGlobal;
  if (!globalRef.global) {
    globalRef.global = globalRef;
  }
  if (!globalRef.__pm4jsReady) {
    await import("pm4js");
    globalRef.__pm4jsReady = true;
  }
  return globalRef;
};

const buildFrequencyDfg = (graph: OcpnGraph) => {
  const transitions = graph.nodes.filter(node => node.type === "TRANSITION");
  const activityByNodeId = new Map<string, string>();
  transitions.forEach(node => {
    activityByNodeId.set(node.id, node.eventUri ?? node.label ?? node.id);
  });

  const activityCounts: Record<string, number> = {};
  const incoming: Record<string, number> = {};
  const outgoing: Record<string, number> = {};
  const pathsFrequency: Record<string, number> = {};

  transitions.forEach(node => {
    const activity = activityByNodeId.get(node.id);
    if (!activity) return;
    const count = node.count ?? 0;
    if (count > 0) {
      activityCounts[activity] = count;
    }
  });

  graph.edges.forEach(edge => {
    const source = activityByNodeId.get(edge.source);
    const target = activityByNodeId.get(edge.target);
    if (!source || !target) return;
    const key = `${source},${target}`;
    pathsFrequency[key] = (pathsFrequency[key] ?? 0) + edge.count;
    outgoing[source] = (outgoing[source] ?? 0) + edge.count;
    incoming[target] = (incoming[target] ?? 0) + edge.count;
  });

  activityByNodeId.forEach(activity => {
    if (!(activity in activityCounts)) {
      activityCounts[activity] = (incoming[activity] ?? 0) + (outgoing[activity] ?? 0);
    }
    if (activityCounts[activity] <= 0) {
      activityCounts[activity] = 1;
    }
  });

  const startActivities: Record<string, number> = {};
  const endActivities: Record<string, number> = {};

  Object.keys(activityCounts).forEach(activity => {
    const inCount = incoming[activity] ?? 0;
    const outCount = outgoing[activity] ?? 0;
    if (inCount === 0 && outCount > 0) {
      startActivities[activity] = outCount;
    }
    if (outCount === 0 && inCount > 0) {
      endActivities[activity] = inCount;
    }
  });

  if (Object.keys(startActivities).length === 0 && Object.keys(activityCounts).length > 0) {
    const startFallback = Object.entries(outgoing).sort((a, b) => b[1] - a[1])[0];
    const activity = startFallback ? startFallback[0] : Object.keys(activityCounts)[0];
    startActivities[activity] = outgoing[activity] ?? activityCounts[activity] ?? 1;
  }

  if (Object.keys(endActivities).length === 0 && Object.keys(activityCounts).length > 0) {
    const endFallback = Object.entries(incoming).sort((a, b) => b[1] - a[1])[0];
    const activity = endFallback ? endFallback[0] : Object.keys(activityCounts)[0];
    endActivities[activity] = incoming[activity] ?? activityCounts[activity] ?? 1;
  }

  return { activityCounts, startActivities, endActivities, pathsFrequency };
};

const mineBpmnGraph = async (graph: OcpnGraph): Promise<BpmnGraph | null> => {
  if (!graph.edges.length) {
    return null;
  }
  const globalRef = await ensurePm4js();
  if (
    !globalRef.FrequencyDfg ||
    !globalRef.InductiveMiner ||
    !globalRef.ProcessTreeToPetriNetConverter ||
    !globalRef.WfNetToBpmnConverter
  ) {
    throw new Error("pm4js failed to initialize.");
  }

  const { activityCounts, startActivities, endActivities, pathsFrequency } = buildFrequencyDfg(graph);
  const frequencyDfg = new globalRef.FrequencyDfg(activityCounts, startActivities, endActivities, pathsFrequency);
  const processTree = globalRef.InductiveMiner.applyDfg(frequencyDfg, 0.0, false);
  const petriNet = globalRef.ProcessTreeToPetriNetConverter.apply(processTree);
  return globalRef.WfNetToBpmnConverter.apply(petriNet);
};

interface FilterPair {
  id: string;
  key: string;
  value: string;
}

export function ProcessMiningPanel() {
  const [ontologyGraph, setOntologyGraph] = useState<OntologyGraph | null>(null);
  const [models, setModels] = useState<OntologyNode[]>([]);
  const [modelUri, setModelUri] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [traceId, setTraceId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [minShare, setMinShare] = useState("0");
  const [collapseObjects, setCollapseObjects] = useState(true);
  const [filters, setFilters] = useState<FilterPair[]>([{ id: "filter-0", key: "", value: "" }]);

  const [graph, setGraph] = useState<OcpnGraph | null>(null);
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mining, setMining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [bpmnGraph, setBpmnGraph] = useState<BpmnGraph | null>(null);
  const [bpmnError, setBpmnError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getOntologyGraph()
      .then(data => {
        if (!active) return;
        setOntologyGraph(data);
        const modelNodes = data.nodes.filter(node => node.label === "ObjectModel");
        setModels(modelNodes);
        if (!modelUri && modelNodes.length > 0) {
          setModelUri(modelNodes[0].uri);
        }
      })
      .catch(() => {
        if (!active) return;
        setOntologyGraph(null);
      });
    return () => {
      active = false;
    };
  }, [modelUri]);

  const modelOptions = useMemo(() => {
    return models.map(node => ({
      uri: node.uri,
      name: ontologyNodeName(node),
    }));
  }, [models]);

  const modelLabels = useMemo(() => {
    return modelOptions.reduce<Record<string, string>>((acc, option) => {
      acc[option.uri] = option.name;
      return acc;
    }, {});
  }, [modelOptions]);

  const eventLabels = useMemo(() => {
    return (ontologyGraph?.nodes || [])
      .filter(node => ["Event", "Transition", "Signal"].includes(node.label))
      .reduce<Record<string, string>>((acc, node) => {
        const name = ontologyNodeName(node);
        const local = iriLocalName(node.uri);
        acc[node.uri] = name;
        if (!(local in acc)) {
          acc[local] = name;
        }
        return acc;
      }, {});
  }, [ontologyGraph]);

  const resolvedFrom = from ? new Date(from).toISOString() : undefined;
  const resolvedTo = to ? new Date(to).toISOString() : undefined;

  const filterPayload = useMemo(() => {
    const active = filters.filter(item => item.key.trim() && item.value.trim());
    if (active.length === 0) return undefined;
    return active.reduce<Record<string, string>>((acc, item) => {
      acc[item.key.trim()] = item.value.trim();
      return acc;
    }, {});
  }, [filters]);

  const loadProcessMining = async () => {
    if (!modelUri) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getOcpnGraph({
        modelUri,
        from: resolvedFrom,
        to: resolvedTo,
        traceId: traceId || undefined,
        workflowId: workflowId || undefined,
        filters: filterPayload,
        minShare: Number.isNaN(Number(minShare)) ? undefined : Number(minShare) / 100,
        collapseObjects,
      });
      setGraph(data);
      setGraphCollapsed(collapseObjects);
      setSelectedNodeId(null);
      setBpmnGraph(null);
      setBpmnError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load process mining data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (!graph || !graphCollapsed) {
      setBpmnGraph(null);
      setBpmnError(null);
      return () => {
        active = false;
      };
    }

    const runMining = async () => {
      setMining(true);
      try {
        const bpmn = await mineBpmnGraph(graph);
        if (!active) return;
        setBpmnGraph(bpmn);
        setBpmnError(null);
      } catch (err) {
        if (!active) return;
        setBpmnGraph(null);
        setBpmnError(err instanceof Error ? err.message : "Failed to run inductive miner");
      } finally {
        if (!active) return;
        setMining(false);
      }
    };

    runMining();
    return () => {
      active = false;
    };
  }, [graph, graphCollapsed]);

  const selectedNode = useMemo(() => {
    if (!graph || !selectedNodeId) return null;
    return graph.nodes.find(node => node.id === selectedNodeId) || null;
  }, [graph, selectedNodeId]);

  const selectedNodeStats = useMemo(() => {
    if (!graph || !selectedNodeId) return null;
    const incoming = graph.edges.filter(edge => edge.target === selectedNodeId);
    const outgoing = graph.edges.filter(edge => edge.source === selectedNodeId);
    const incomingTotal = incoming.reduce((sum, edge) => sum + edge.count, 0);
    const outgoingTotal = outgoing.reduce((sum, edge) => sum + edge.count, 0);
    return {
      incoming,
      outgoing,
      incomingTotal,
      outgoingTotal,
    };
  }, [graph, selectedNodeId]);

  const formatTimestamp = (value?: string | null) => {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? "—" : parsed.toLocaleString();
  };

  const colorForModel = (modelUri: string) => {
    let hash = 0;
    for (let i = 0; i < modelUri.length; i += 1) {
      hash = (hash * 31 + modelUri.charCodeAt(i)) % 360;
    }
    return `hsl(${hash}, 55%, 35%)`;
  };

  const modelLegend = useMemo(() => {
    if (!graph) return [];
    const active = new Set<string>();
    graph.edges.forEach(edge => {
      if (edge.modelUri) {
        active.add(edge.modelUri);
      }
    });
    return Array.from(active).sort().map(uri => ({
      uri,
      name: modelLabels[uri] ?? iriLocalName(uri),
      color: colorForModel(uri),
    }));
  }, [graph, modelLabels]);

  const updateFilter = (id: string, updates: Partial<FilterPair>) => {
    setFilters(prev => prev.map(item => (item.id === id ? { ...item, ...updates } : item)));
  };

  const addFilter = () => {
    setFilters(prev => [...prev, { id: `filter-${prev.length + 1}`, key: "", value: "" }]);
  };

  const removeFilter = (id: string) => {
    setFilters(prev => prev.filter(item => item.id !== id));
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Process Mining</p>
            <h1 className="mt-3 font-display text-3xl">Object-Centric Flow</h1>
            <p className="mt-3 text-sm text-muted-foreground max-w-2xl">
              Places are object types, transitions are events, and arcs show how events touch multiple objects in time.
            </p>
          </div>
          <Badge className="gap-2 rounded-full bg-muted px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em]">
            <Activity className="h-3 w-3" />
            OCPN
          </Badge>
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Filter className="h-4 w-4" />
          Process Filters
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr_0.6fr]">
          <div className="space-y-2">
            <Label htmlFor="model">Object model</Label>
            <Select value={modelUri} onValueChange={value => setModelUri(value)}>
              <SelectTrigger id="model">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map(option => (
                  <SelectItem key={option.uri} value={option.uri}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="from">From</Label>
            <Input id="from" type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="to">To</Label>
            <Input id="to" type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={loadProcessMining} disabled={!modelUri || loading}>
              {loading ? "Loading..." : "Run mining"}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="trace">Trace ID (optional)</Label>
            <Input id="trace" placeholder="UUID" value={traceId} onChange={e => setTraceId(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workflow">Workflow ID (optional)</Label>
            <Input id="workflow" placeholder="UUID" value={workflowId} onChange={e => setWorkflowId(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="minShare">Min edge share (%)</Label>
            <Input
              id="minShare"
              type="number"
              min="0"
              max="100"
              step="1"
              value={minShare}
              onChange={e => setMinShare(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="collapseObjects">Edge coloring</Label>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm">
              <input
                id="collapseObjects"
                type="checkbox"
                checked={collapseObjects}
                onChange={e => setCollapseObjects(e.target.checked)}
              />
              <span>Collapse object places, color edges by object type</span>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-muted/40 p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Object property filters
            </div>
            <Button variant="outline" size="sm" onClick={addFilter}>
              Add filter
            </Button>
          </div>
          <div className="mt-4 space-y-3">
            {filters.map(filter => (
              <div key={filter.id} className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
                <Input
                  placeholder="property key"
                  value={filter.key}
                  onChange={e => updateFilter(filter.id, { key: e.target.value })}
                />
                <Input
                  placeholder="value"
                  value={filter.value}
                  onChange={e => updateFilter(filter.id, { value: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFilter(filter.id)}
                  disabled={filters.length === 1}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Layers className="h-4 w-4" />
          Object-Centric Petri Net
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            {graph && modelUri ? (
              <OcpnGraphView
                graph={graph}
                modelLabels={modelLabels}
                eventLabels={eventLabels}
                selectedNodeId={selectedNodeId}
                onNodeSelect={setSelectedNodeId}
                collapseObjects={collapseObjects}
              />
            ) : (
              <div className="flex h-[680px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
                Select a model to render the process mining graph.
              </div>
            )}
          </div>
          <div className="space-y-4">
            <Card className="rounded-2xl border border-border bg-background p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Node Inspector
              </div>
              {selectedNode ? (
                <div className="mt-3 space-y-3 text-sm">
                  <div className="font-display text-lg">
                    {selectedNode.type === "PLACE"
                      ? modelLabels[selectedNode.modelUri ?? ""] || iriLocalName(selectedNode.label ?? "")
                      : eventLabels?.[selectedNode.eventUri ?? ""] || iriLocalName(selectedNode.label ?? "")}
                  </div>
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    {selectedNode.type === "PLACE" ? "Object type" : "Event"}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <div className="text-[0.65rem] uppercase tracking-[0.2em]">In</div>
                      <div className="text-sm text-foreground">{selectedNodeStats?.incomingTotal ?? 0}</div>
                    </div>
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <div className="text-[0.65rem] uppercase tracking-[0.2em]">Out</div>
                      <div className="text-sm text-foreground">{selectedNodeStats?.outgoingTotal ?? 0}</div>
                    </div>
                  </div>
                  {selectedNode.type === "TRANSITION" && (
                    <div className="grid gap-2 text-xs text-muted-foreground">
                      <div className="rounded-lg border border-border bg-background px-3 py-2">
                        <div className="text-[0.65rem] uppercase tracking-[0.2em]">First seen</div>
                        <div className="text-sm text-foreground">{formatTimestamp(selectedNode.firstSeen)}</div>
                      </div>
                      <div className="rounded-lg border border-border bg-background px-3 py-2">
                        <div className="text-[0.65rem] uppercase tracking-[0.2em]">Median seen</div>
                        <div className="text-sm text-foreground">{formatTimestamp(selectedNode.medianSeen)}</div>
                      </div>
                      <div className="rounded-lg border border-border bg-background px-3 py-2">
                        <div className="text-[0.65rem] uppercase tracking-[0.2em]">Last seen</div>
                        <div className="text-sm text-foreground">{formatTimestamp(selectedNode.lastSeen)}</div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-3 text-sm text-muted-foreground">
                  Click a node to inspect its flow statistics.
                </div>
              )}
            </Card>
            {selectedNode && selectedNodeStats && (
              <Card className="rounded-2xl border border-border bg-background p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Flow Summary
                </div>
                <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Incoming edges</span>
                    <span className="text-foreground">{selectedNodeStats.incoming.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Outgoing edges</span>
                    <span className="text-foreground">{selectedNodeStats.outgoing.length}</span>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
        {graph && graph.edges.length === 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            No OCPN edges yet. This usually means events are missing object links in `event_object_links`.
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-6 rounded-full bg-foreground/20" />
            Edge thickness = % share (within object type)
          </div>
          {!collapseObjects && (
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-border bg-[color:var(--graph-node-state-bg)] text-[0.6rem] font-semibold">
                O
              </span>
              Object type nodes show linked event volume
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em]">
              event
            </span>
            Transition nodes represent ontology event concepts
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em]">
              time
            </span>
            Columns are ordered by median event time (bucketed to minutes)
          </div>
          {collapseObjects && (
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em]">
                color
              </span>
              Edge color = object type
            </div>
          )}
        </div>
        {collapseObjects && modelLegend.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {modelLegend.map(item => (
              <div key={item.uri} className="flex items-center gap-2 rounded-full border border-border px-3 py-1">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-foreground">{item.name}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Layers className="h-4 w-4" />
          Inductive Miner (BPMN)
        </div>
        <div className="mt-4">
          {!graph || !graphCollapsed ? (
            <div className="flex h-[520px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
              Enable collapse object places and run mining to generate the inductive model.
            </div>
          ) : mining ? (
            <div className="flex h-[520px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
              Running inductive miner...
            </div>
          ) : bpmnGraph ? (
            <BpmnGraphView graph={bpmnGraph} labelMap={eventLabels} />
          ) : bpmnError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {bpmnError}
            </div>
          ) : (
            <div className="flex h-[520px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
              No inductive model yet. Try lowering the minimum edge share.
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-4 w-6 items-center justify-center rounded-md border border-[color:var(--graph-node-action-border)] bg-[color:var(--graph-node-action-bg)]" />
            Task (business step)
          </div>
          <div className="flex items-center gap-2">
            <span className="relative inline-flex h-4 w-4 rotate-45 items-center justify-center rounded border border-[color:var(--graph-node-trigger-border)] bg-[color:var(--graph-node-trigger-bg)] text-[0.5rem] font-semibold text-foreground">
              X
            </span>
            Decision gateway
          </div>
          <div className="flex items-center gap-2">
            <span className="relative inline-flex h-4 w-4 rotate-45 items-center justify-center rounded border border-[color:var(--graph-node-trigger-border)] bg-[color:var(--graph-node-trigger-bg)] text-[0.5rem] font-semibold text-foreground">
              +
            </span>
            Parallel gateway
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[color:var(--graph-node-default-border)] bg-[color:var(--graph-node-default-bg)]" />
            Event (start or end)
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-0.5 w-6 items-center justify-center rounded-full bg-[color:var(--graph-edge-default)]">
              <span className="ml-5 h-0 w-0 border-y-4 border-l-4 border-y-transparent border-l-[color:var(--graph-edge-default)]" />
            </span>
            Sequence flow
          </div>
        </div>
      </Card>
    </div>
  );
}
