"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Filter, Layers } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { InspectorScopeFilters, type SharedWindowPreset } from "./inspector-scope-filters";

import { getOcdfgGraph, getOcpnGraph, toOcpnGraphFromOcdfg } from "@/app/lib/api/process-mining";
import { useOntologyDisplay } from "@/app/lib/ontology-display";
import type { OcdfgGraph, OcpnGraph } from "@/app/types/process-mining";
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

const toDatetimeLocalValue = (date: Date): string => {
  const withOffset = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return withOffset.toISOString().slice(0, 16);
};

export function ProcessMiningPanel() {
  const ontologyDisplay = useOntologyDisplay();
  const [modelUri, setModelUri] = useState("");
  const [windowPreset, setWindowPreset] = useState<SharedWindowPreset>("24h");
  const [from, setFrom] = useState(() => {
    const now = new Date();
    return toDatetimeLocalValue(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  });
  const [to, setTo] = useState(() => toDatetimeLocalValue(new Date()));
  const [traceId, setTraceId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [minShare, setMinShare] = useState("0");
  const [collapseObjects, setCollapseObjects] = useState(true);
  const [filters, setFilters] = useState<FilterPair[]>([{ id: "filter-0", key: "", value: "" }]);

  const [ocdfgGraph, setOcdfgGraph] = useState<OcdfgGraph | null>(null);
  const [ocpnGraph, setOcpnGraph] = useState<OcpnGraph | null>(null);
  const [ocpnGraphCollapsed, setOcpnGraphCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mining, setMining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [bpmnGraph, setBpmnGraph] = useState<BpmnGraph | null>(null);
  const [bpmnError, setBpmnError] = useState<string | null>(null);

  const modelOptions = useMemo(() => {
    return [...ontologyDisplay.catalog.objectModels]
      .map((model) => ({
        uri: model.uri,
        name: ontologyDisplay.displayObjectType(model.uri),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ontologyDisplay]);

  useEffect(() => {
    if (!modelUri && modelOptions.length > 0) {
      setModelUri(modelOptions[0].uri);
    }
  }, [modelOptions, modelUri]);

  const modelLabels = useMemo(() => {
    return modelOptions.reduce<Record<string, string>>((acc, option) => {
      acc[option.uri] = option.name;
      return acc;
    }, {});
  }, [modelOptions]);

  const ocdfgRenderGraph = useMemo(() => {
    if (!ocdfgGraph) {
      return null;
    }
    return toOcpnGraphFromOcdfg(ocdfgGraph);
  }, [ocdfgGraph]);

  const ocdfgEventLabels = useMemo(() => {
    if (!ocdfgRenderGraph) {
      return {};
    }
    return ocdfgRenderGraph.nodes.reduce<Record<string, string>>((acc, node) => {
      if (node.type !== "TRANSITION") {
        return acc;
      }
      const label = ontologyDisplay.displayEventType(node.eventUri ?? node.label ?? node.id);
      if (node.eventUri) {
        acc[node.eventUri] = label;
      }
      if (node.label) {
        acc[node.label] = label;
      }
      return acc;
    }, {});
  }, [ocdfgRenderGraph, ontologyDisplay]);

  const ocpnEventLabels = useMemo(() => {
    if (!ocpnGraph) {
      return {};
    }
    return ocpnGraph.nodes.reduce<Record<string, string>>((acc, node) => {
      if (node.type !== "TRANSITION") {
        return acc;
      }
      const label = ontologyDisplay.displayEventType(node.eventUri ?? node.label ?? node.id);
      if (node.eventUri) {
        acc[node.eventUri] = label;
      }
      if (node.label) {
        acc[node.label] = label;
      }
      return acc;
    }, {});
  }, [ocpnGraph, ontologyDisplay]);

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

  const applyWindowPreset = (preset: Exclude<SharedWindowPreset, "custom">) => {
    setWindowPreset(preset);
    const now = new Date();
    const durationMsByPreset: Record<Exclude<SharedWindowPreset, "custom">, number> = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };
    const start = new Date(now.getTime() - durationMsByPreset[preset]);
    setFrom(toDatetimeLocalValue(start));
    setTo(toDatetimeLocalValue(now));
  };

  const loadProcessMining = async () => {
    if (!modelUri) return;
    setLoading(true);
    setError(null);
    try {
      const requestPayload = {
        modelUri,
        from: resolvedFrom,
        to: resolvedTo,
        traceId: traceId || undefined,
        workflowId: workflowId || undefined,
        filters: filterPayload,
        minShare: Number.isNaN(Number(minShare)) ? undefined : Number(minShare) / 100,
        collapseObjects,
      };
      const [ocdfgData, ocpnData] = await Promise.all([
        getOcdfgGraph(requestPayload),
        getOcpnGraph(requestPayload),
      ]);
      setOcdfgGraph(ocdfgData);
      setOcpnGraph(ocpnData);
      setOcpnGraphCollapsed(collapseObjects);
      setSelectedNodeId(null);
      setBpmnGraph(null);
      setBpmnError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load OC-DFG process mining data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (!ocpnGraph || !ocpnGraphCollapsed) {
      setBpmnGraph(null);
      setBpmnError(null);
      return () => {
        active = false;
      };
    }

    const runMining = async () => {
      setMining(true);
      try {
        const bpmn = await mineBpmnGraph(ocpnGraph);
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
  }, [ocpnGraph, ocpnGraphCollapsed]);

  const selectedNode = useMemo(() => {
    if (!ocdfgRenderGraph || !selectedNodeId) return null;
    return ocdfgRenderGraph.nodes.find(node => node.id === selectedNodeId) || null;
  }, [ocdfgRenderGraph, selectedNodeId]);

  const selectedNodeStats = useMemo(() => {
    if (!ocdfgRenderGraph || !selectedNodeId) return null;
    const incoming = ocdfgRenderGraph.edges.filter(edge => edge.target === selectedNodeId);
    const outgoing = ocdfgRenderGraph.edges.filter(edge => edge.source === selectedNodeId);
    const incomingTotal = incoming.reduce((sum, edge) => sum + edge.count, 0);
    const outgoingTotal = outgoing.reduce((sum, edge) => sum + edge.count, 0);
    return {
      incoming,
      outgoing,
      incomingTotal,
      outgoingTotal,
    };
  }, [ocdfgRenderGraph, selectedNodeId]);

  const colorForModel = (modelUri: string) => {
    let hash = 0;
    for (let i = 0; i < modelUri.length; i += 1) {
      hash = (hash * 31 + modelUri.charCodeAt(i)) % 360;
    }
    return `hsl(${hash}, 55%, 35%)`;
  };

  const modelLegend = useMemo(() => {
    if (!ocdfgRenderGraph) return [];
    const active = new Set<string>();
    ocdfgRenderGraph.edges.forEach(edge => {
      if (edge.modelUri) {
        active.add(edge.modelUri);
      }
    });
    return Array.from(active).sort().map(uri => ({
      uri,
      name: modelLabels[uri] ?? ontologyDisplay.displayObjectType(uri),
      color: colorForModel(uri),
    }));
  }, [ocdfgRenderGraph, modelLabels, ontologyDisplay]);

  const boundarySummary = useMemo(() => {
    if (!ocdfgGraph) {
      return {
        start: [] as Array<{ id: string; activity: string; objectType: string; count: number }>,
        end: [] as Array<{ id: string; activity: string; objectType: string; count: number }>,
      };
    }

    const sortByCountDesc = (
      rows: Array<{ id: string; activity: string; objectType: string; count: number }>
    ) => {
      return [...rows].sort((a, b) => b.count - a.count);
    };

    const start = sortByCountDesc(
      ocdfgGraph.startActivities.map((item) => ({
        id: item.id,
        activity: item.activity,
        objectType: item.objectType,
        count: item.count,
      }))
    );
    const end = sortByCountDesc(
      ocdfgGraph.endActivities.map((item) => ({
        id: item.id,
        activity: item.activity,
        objectType: item.objectType,
        count: item.count,
      }))
    );
    return { start, end };
  }, [ocdfgGraph]);

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
            <h1 className="mt-3 font-display text-3xl">Object-Centric Process Explorer</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              OC-DFG is the first diagram for activity flow analysis. OCPN and BPMN remain available as secondary views.
            </p>
          </div>
          <Badge className="gap-2 rounded-full bg-muted px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em]">
            <Activity className="h-3 w-3" />
            OC-DFG First
          </Badge>
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Filter className="h-4 w-4" />
          Process Filters
        </div>

        <div className="mt-6">
          <InspectorScopeFilters
            windowPreset={windowPreset}
            onApplyWindowPreset={applyWindowPreset}
            onCustomWindowChange={() => setWindowPreset("custom")}
            modelId="mining-model"
            modelLabel="Object model"
            modelValue={modelUri}
            modelOptions={modelOptions.map((option) => ({ value: option.uri, label: option.name }))}
            onModelChange={setModelUri}
            fromId="mining-from"
            fromValue={from}
            onFromChange={setFrom}
            toId="mining-to"
            toValue={to}
            onToChange={setTo}
            runLabel="Run mining"
            runningLabel="Loading..."
            isRunning={loading}
            runDisabled={!modelUri || loading}
            onRun={loadProcessMining}
          />
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
            <Label htmlFor="collapseObjects">Secondary OCPN options</Label>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm">
              <input
                id="collapseObjects"
                type="checkbox"
                checked={collapseObjects}
                onChange={e => setCollapseObjects(e.target.checked)}
              />
              <span>Collapse object places for OCPN and enable BPMN conversion</span>
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
          Object-Centric Directly-Follows Graph (Primary)
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            {ocdfgRenderGraph && modelUri ? (
              <OcpnGraphView
                graph={ocdfgRenderGraph}
                modelLabels={modelLabels}
                eventLabels={ocdfgEventLabels}
                selectedNodeId={selectedNodeId}
                onNodeSelect={setSelectedNodeId}
                collapseObjects
              />
            ) : (
              <div className="flex h-[680px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
                Select a model to render the OC-DFG graph.
              </div>
            )}
          </div>
          <div className="space-y-4">
            <Card className="rounded-2xl border border-border bg-background p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Activity Inspector
              </div>
              {selectedNode ? (
                <div className="mt-3 space-y-3 text-sm">
                  <div className="font-display text-lg">
                    {ontologyDisplay.displayEventType(selectedNode.eventUri ?? selectedNode.label ?? null)}
                  </div>
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Activity</div>
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
                </div>
              ) : (
                <div className="mt-3 text-sm text-muted-foreground">
                  Click an activity node to inspect incoming and outgoing flow.
                </div>
              )}
            </Card>
            <Card className="rounded-2xl border border-border bg-background p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Start / End Activities
              </div>
              {ocdfgGraph ? (
                <div className="mt-3 grid gap-3 text-xs text-muted-foreground">
                  <div>
                    <div className="mb-1 uppercase tracking-[0.2em]">Start</div>
                    {boundarySummary.start.length > 0 ? (
                      <div className="space-y-1">
                        {boundarySummary.start.slice(0, 6).map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-3">
                            <span className="truncate">
                              {ontologyDisplay.displayEventType(item.activity)} ·{" "}
                              {modelLabels[item.objectType] ?? ontologyDisplay.displayObjectType(item.objectType)}
                            </span>
                            <span className="text-foreground">{item.count}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-muted-foreground">No start activity markers.</div>
                    )}
                  </div>
                  <div>
                    <div className="mb-1 uppercase tracking-[0.2em]">End</div>
                    {boundarySummary.end.length > 0 ? (
                      <div className="space-y-1">
                        {boundarySummary.end.slice(0, 6).map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-3">
                            <span className="truncate">
                              {ontologyDisplay.displayEventType(item.activity)} ·{" "}
                              {modelLabels[item.objectType] ?? ontologyDisplay.displayObjectType(item.objectType)}
                            </span>
                            <span className="text-foreground">{item.count}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-muted-foreground">No end activity markers.</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-sm text-muted-foreground">
                  Run mining to view OC-DFG start and end activity summaries.
                </div>
              )}
            </Card>
          </div>
        </div>
        {ocdfgRenderGraph && ocdfgRenderGraph.edges.length === 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            No OC-DFG edges are visible for the current filters and minimum share threshold.
          </div>
        )}
        {ocdfgGraph && ocdfgGraph.warnings.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {ocdfgGraph.warnings.join(" ")}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-6 rounded-full bg-foreground/20" />
            Edge thickness = OC-DFG count share (within object type)
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em]">
              event
            </span>
            Nodes are event activities from pm4py OC-DFG
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em]">
              color
            </span>
            Edge color = object type
          </div>
        </div>
        {modelLegend.length > 0 && (
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
          Object-Centric Petri Net (Secondary)
        </div>
        <div className="mt-4">
          {ocpnGraph ? (
            <OcpnGraphView
              graph={ocpnGraph}
              modelLabels={modelLabels}
              eventLabels={ocpnEventLabels}
              selectedNodeId={null}
              onNodeSelect={() => {}}
              collapseObjects={collapseObjects}
            />
          ) : (
            <div className="flex h-[520px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
              Run mining to render the secondary OCPN view.
            </div>
          )}
        </div>
        {ocpnGraph && ocpnGraph.edges.length === 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            No OCPN edges yet. This usually means events are missing object links in `event_object_links`.
          </div>
        )}
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Layers className="h-4 w-4" />
          Inductive Miner (BPMN)
        </div>
        <div className="mt-4">
          {!ocpnGraph || !ocpnGraphCollapsed ? (
            <div className="flex h-[520px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
              Enable OCPN collapse and run mining to generate the secondary BPMN model.
            </div>
          ) : mining ? (
            <div className="flex h-[520px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
              Running inductive miner...
            </div>
          ) : bpmnGraph ? (
            <BpmnGraphView graph={bpmnGraph} labelMap={ocpnEventLabels} />
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
