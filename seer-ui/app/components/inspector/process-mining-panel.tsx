"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, Filter, Layers } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { InspectorScopeFilters, type SharedWindowPreset } from "./inspector-scope-filters";

import { getOcdfgGraph, getOcpnGraph } from "@/app/lib/api/process-mining";
import { useOntologyDisplay } from "@/app/lib/ontology-display";
import { buildReferenceEdges } from "@/app/components/ontology/graph-reference-edges";
import { useOntologyGraphContext } from "@/app/components/providers/ontology-graph-provider";
import type { OntologyGraph } from "@/app/types/ontology";
import type { OcdfgGraph, OcpnGraph } from "@/app/types/process-mining";
import { OcpnGraph as OcpnGraphView } from "./ocpn-graph";
import { OcdfgGraph as OcdfgGraphView } from "./ocdfg-graph";
import { BpmnGraph as BpmnGraphView } from "./bpmn-graph";
import { mergeSearchParams, parseBooleanSearchParam } from "@/app/lib/url-state";

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

type ReadableSearchParams = Pick<URLSearchParams, "get" | "getAll">;

const toDatetimeLocalValue = (date: Date): string => {
  const withOffset = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return withOffset.toISOString().slice(0, 16);
};

const EVENT_NODE_LABELS = new Set(["Event", "Signal", "Transition"]);
const ACTION_NODE_LABELS = new Set(["Action", "Process", "Workflow"]);
const DEPTH_OPTIONS = ["1", "2", "3", "4", "5"];
const PM_FILTER_PARAM = "pm_filter";

function defaultWindowRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: toDatetimeLocalValue(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
    to: toDatetimeLocalValue(now),
  };
}

function decodeSearchToken(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function normalizeDateTimeLocalValue(value: string | null | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return fallback;
  }
  return toDatetimeLocalValue(parsed);
}

function toIsoDateTime(value: string): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }
  return parsed.toISOString();
}

function serializeMiningFilters(filters: FilterPair[]): string[] {
  return filters
    .filter((filter) => filter.key.trim() || filter.value.trim())
    .map((filter) => [filter.key.trim(), filter.value.trim()].map(encodeURIComponent).join("~"));
}

function parseMiningFilters(searchParams: ReadableSearchParams): FilterPair[] {
  const filters = searchParams
    .getAll(PM_FILTER_PARAM)
    .map((entry, index) => {
      const [rawKey = "", rawValue = ""] = entry.split("~", 2);
      return {
        id: `filter-${index}`,
        key: decodeSearchToken(rawKey),
        value: decodeSearchToken(rawValue),
      };
    })
    .filter((filter) => filter.key || filter.value);

  return filters.length > 0 ? filters : [{ id: "filter-0", key: "", value: "" }];
}

function areMiningFiltersEqual(left: FilterPair[], right: FilterPair[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((filter, index) => {
    const candidate = right[index];
    return candidate && filter.key === candidate.key && filter.value === candidate.value;
  });
}

function areSerializedFiltersEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function resolveDepthScopedModels(options: {
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

  const nodeByUri = new Map(graph.nodes.map((node) => [node.uri, node]));
  const allEdges = [...graph.edges, ...buildReferenceEdges(graph.nodes, graph.edges)];
  const eventToModels = new Map<string, Set<string>>();
  const actionToModels = new Map<string, Set<string>>();
  const actionToProducedEvents = new Map<string, Set<string>>();

  const addEventModelLink = (eventUri: string, modelUri: string) => {
    const eventNode = nodeByUri.get(eventUri);
    if (!eventNode || !EVENT_NODE_LABELS.has(eventNode.label) || !knownModelUris.has(modelUri)) {
      return;
    }
    const scoped = eventToModels.get(eventUri);
    if (scoped) {
      scoped.add(modelUri);
      return;
    }
    eventToModels.set(eventUri, new Set([modelUri]));
  };

  allEdges.forEach((edge) => {
    if (edge.type === "transitionOf") {
      addEventModelLink(edge.fromUri, edge.toUri);
      return;
    }
    if (edge.type === "referencesObjectModel") {
      const sourceNode = nodeByUri.get(edge.fromUri);
      if (!sourceNode) {
        return;
      }
      if (EVENT_NODE_LABELS.has(sourceNode.label)) {
        addEventModelLink(edge.fromUri, edge.toUri);
      }
      if (ACTION_NODE_LABELS.has(sourceNode.label) && knownModelUris.has(edge.toUri)) {
        const models = actionToModels.get(edge.fromUri);
        if (models) {
          models.add(edge.toUri);
        } else {
          actionToModels.set(edge.fromUri, new Set([edge.toUri]));
        }
      }
      return;
    }
    if (edge.type === "producesEvent") {
      const sourceNode = nodeByUri.get(edge.fromUri);
      const targetNode = nodeByUri.get(edge.toUri);
      if (
        !sourceNode ||
        !targetNode ||
        !ACTION_NODE_LABELS.has(sourceNode.label) ||
        !EVENT_NODE_LABELS.has(targetNode.label)
      ) {
        return;
      }
      const produced = actionToProducedEvents.get(edge.fromUri);
      if (produced) {
        produced.add(edge.toUri);
      } else {
        actionToProducedEvents.set(edge.fromUri, new Set([edge.toUri]));
      }
    }
  });

  actionToModels.forEach((modelUris, actionUri) => {
    const producedEvents = actionToProducedEvents.get(actionUri);
    if (!producedEvents || producedEvents.size === 0) {
      return;
    }
    producedEvents.forEach((eventUri) => {
      modelUris.forEach((modelUri) => {
        addEventModelLink(eventUri, modelUri);
      });
    });
  });

  const adjacency = new Map<string, Set<string>>();
  eventToModels.forEach((models) => {
    const scopedModels = [...models];
    scopedModels.forEach((sourceModel) => {
      const neighbors = adjacency.get(sourceModel);
      const bucket = neighbors ?? new Set<string>();
      scopedModels.forEach((targetModel) => {
        if (targetModel !== sourceModel) {
          bucket.add(targetModel);
        }
      });
      if (!neighbors) {
        adjacency.set(sourceModel, bucket);
      }
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

  const extras = [...included]
    .filter((uri) => uri !== anchorModelUri)
    .sort((a, b) => a.localeCompare(b));
  return [anchorModelUri, ...extras];
}

interface ProcessMiningPanelProps {
  isActive: boolean;
}

export function ProcessMiningPanel({ isActive }: ProcessMiningPanelProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const ontologyDisplay = useOntologyDisplay();
  const { graph: ontologyGraph } = useOntologyGraphContext();
  const [modelUri, setModelUri] = useState(() => searchParams.get("pm_model") ?? "");
  const [depth, setDepth] = useState(() => searchParams.get("pm_depth") ?? "1");
  const [windowPreset, setWindowPreset] = useState<SharedWindowPreset>(() => {
    const preset = searchParams.get("pm_preset");
    return preset === "7d" || preset === "30d" || preset === "custom" ? preset : "24h";
  });
  const [from, setFrom] = useState(() =>
    normalizeDateTimeLocalValue(searchParams.get("pm_from"), defaultWindowRange().from)
  );
  const [to, setTo] = useState(() =>
    normalizeDateTimeLocalValue(searchParams.get("pm_to"), defaultWindowRange().to)
  );
  const [traceId, setTraceId] = useState(() => searchParams.get("pm_trace") ?? "");
  const [workflowId, setWorkflowId] = useState(() => searchParams.get("pm_workflow") ?? "");
  const [minShare, setMinShare] = useState(() => searchParams.get("pm_min_share") ?? "0");
  const [collapseObjects, setCollapseObjects] = useState(() =>
    parseBooleanSearchParam(searchParams.get("pm_collapse"), true)
  );
  const [filters, setFilters] = useState<FilterPair[]>(() => parseMiningFilters(searchParams));

  const [ocdfgGraph, setOcdfgGraph] = useState<OcdfgGraph | null>(null);
  const [ocpnGraph, setOcpnGraph] = useState<OcpnGraph | null>(null);
  const [ocpnGraphCollapsed, setOcpnGraphCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mining, setMining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => searchParams.get("pm_node"));
  const [bpmnGraph, setBpmnGraph] = useState<BpmnGraph | null>(null);
  const [bpmnError, setBpmnError] = useState<string | null>(null);
  const resultsSummaryRef = useRef<HTMLDivElement | null>(null);
  const ocdfgSectionRef = useRef<HTMLDivElement | null>(null);
  const ocpnSectionRef = useRef<HTMLDivElement | null>(null);
  const bpmnSectionRef = useRef<HTMLDivElement | null>(null);
  const autoRunSignatureRef = useRef("");
  const completionSignatureRef = useRef("");
  const filterSyncSourceRef = useRef<"local" | "url">("local");

  const replaceQuery = useCallback((updates: Record<string, string | string[] | null | undefined>) => {
    const nextQuery = mergeSearchParams(searchParams, updates);
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", nextUrl);
    }
    startTransition(() => {
      router.replace(nextUrl, { scroll: false });
    });
  }, [pathname, router, searchParams]);

  const clearMiningResults = useCallback(() => {
    setOcdfgGraph(null);
    setOcpnGraph(null);
    setOcpnGraphCollapsed(false);
    setSelectedNodeId(null);
    setBpmnGraph(null);
    setBpmnError(null);
    completionSignatureRef.current = "";
  }, []);

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

  useEffect(() => {
    const fallbackWindow = defaultWindowRange();
    const nextModelUri = searchParams.get("pm_model") ?? modelOptions[0]?.uri ?? "";
    const nextDepth = DEPTH_OPTIONS.includes(searchParams.get("pm_depth") ?? "")
      ? (searchParams.get("pm_depth") as string)
      : "1";
    const nextPreset = searchParams.get("pm_preset");
    const nextWindowPreset =
      nextPreset === "7d" || nextPreset === "30d" || nextPreset === "custom" ? nextPreset : "24h";
    const nextTraceId = searchParams.get("pm_trace") ?? "";
    const nextWorkflowId = searchParams.get("pm_workflow") ?? "";
    const nextMinShare = searchParams.get("pm_min_share") ?? "0";
    const nextCollapseObjects = parseBooleanSearchParam(searchParams.get("pm_collapse"), true);
    const nextSelectedNodeId = searchParams.get("pm_node");
    const nextFilters = parseMiningFilters(searchParams);
    const nextRunRequested = searchParams.get("pm_run") === "1";

    setModelUri((current) => (current === nextModelUri ? current : nextModelUri));
    setDepth((current) => (current === nextDepth ? current : nextDepth));
    setWindowPreset((current) => (current === nextWindowPreset ? current : nextWindowPreset));
    setFrom((current) => {
      const nextFrom = normalizeDateTimeLocalValue(searchParams.get("pm_from"), fallbackWindow.from);
      return current === nextFrom ? current : nextFrom;
    });
    setTo((current) => {
      const nextTo = normalizeDateTimeLocalValue(searchParams.get("pm_to"), fallbackWindow.to);
      return current === nextTo ? current : nextTo;
    });
    setTraceId((current) => (current === nextTraceId ? current : nextTraceId));
    setWorkflowId((current) => (current === nextWorkflowId ? current : nextWorkflowId));
    setMinShare((current) => (current === nextMinShare ? current : nextMinShare));
    setCollapseObjects((current) => (current === nextCollapseObjects ? current : nextCollapseObjects));
    setSelectedNodeId((current) => (current === nextSelectedNodeId ? current : nextSelectedNodeId));
    setFilters((current) => {
      if (areMiningFiltersEqual(current, nextFilters)) {
        return current;
      }
      filterSyncSourceRef.current = "url";
      return nextFilters;
    });
    if (!nextRunRequested) {
      clearMiningResults();
      autoRunSignatureRef.current = "";
    }
  }, [clearMiningResults, modelOptions, searchParams]);

  useEffect(() => {
    if (filterSyncSourceRef.current === "url") {
      filterSyncSourceRef.current = "local";
      return;
    }
    const serializedFilters = serializeMiningFilters(filters);
    const currentFilters = searchParams.getAll(PM_FILTER_PARAM);
    if (areSerializedFiltersEqual(serializedFilters, currentFilters)) {
      return;
    }
    replaceQuery({
      pm_filter: serializedFilters,
      pm_run: null,
      pm_node: null,
    });
  }, [filters, replaceQuery, searchParams]);

  const modelLabels = useMemo(() => {
    return modelOptions.reduce<Record<string, string>>((acc, option) => {
      acc[option.uri] = option.name;
      return acc;
    }, {});
  }, [modelOptions]);

  const resolvedDepth = useMemo(() => {
    const parsed = Number.parseInt(depth, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }, [depth]);

  const knownModelUris = useMemo(() => new Set(modelOptions.map((option) => option.uri)), [modelOptions]);

  const resolvedModelUris = useMemo(() => {
    return resolveDepthScopedModels({
      anchorModelUri: modelUri,
      depth: resolvedDepth,
      graph: ontologyGraph,
      knownModelUris,
    });
  }, [knownModelUris, modelUri, ontologyGraph, resolvedDepth]);

  const includedModels = useMemo(() => {
    return resolvedModelUris
      .map((uri) => ({
        uri,
        name: modelLabels[uri] ?? ontologyDisplay.displayObjectType(uri),
        isAnchor: uri === modelUri,
      }))
      .sort((a, b) => {
        if (a.isAnchor) return -1;
        if (b.isAnchor) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [modelLabels, modelUri, ontologyDisplay, resolvedModelUris]);

  const ocdfgEventLabels = useMemo(() => {
    if (!ocdfgGraph) {
      return {};
    }
    return ocdfgGraph.nodes.reduce<Record<string, string>>((acc, node) => {
      if (node.kind !== "activity" || !node.activity) {
        return acc;
      }
      const label = ontologyDisplay.displayEventType(node.activity);
      acc[node.activity] = label;
      return acc;
    }, {});
  }, [ocdfgGraph, ontologyDisplay]);

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

  const resolvedFrom = useMemo(() => toIsoDateTime(from), [from]);
  const resolvedTo = useMemo(() => toIsoDateTime(to), [to]);

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
    const nextFrom = toDatetimeLocalValue(start);
    const nextTo = toDatetimeLocalValue(now);
    setFrom(nextFrom);
    setTo(nextTo);
    replaceQuery({
      pm_preset: preset,
      pm_from: nextFrom,
      pm_to: nextTo,
      pm_run: null,
      pm_node: null,
    });
  };

  const persistRunQuery = useCallback((nodeId?: string | null) => {
    replaceQuery({
      pm_model: modelUri,
      pm_depth: depth,
      pm_preset: windowPreset,
      pm_from: from,
      pm_to: to,
      pm_trace: traceId || null,
      pm_workflow: workflowId || null,
      pm_min_share: minShare,
      pm_collapse: collapseObjects ? "1" : "0",
      pm_filter: serializeMiningFilters(filters),
      pm_run: "1",
      pm_node: nodeId || null,
    });
  }, [collapseObjects, depth, filters, from, minShare, modelUri, replaceQuery, to, traceId, windowPreset, workflowId]);

  const loadProcessMining = useCallback(async () => {
    if (!modelUri) return;
    if (!resolvedFrom || !resolvedTo) {
      setError("Select a valid time window before running mining.");
      return;
    }
    if (resolvedFrom > resolvedTo) {
      setError("The start time must be earlier than the end time.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const requestedNodeId = searchParams.get("pm_node");
      const requestPayload = {
        modelUri,
        modelUris: resolvedModelUris,
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
      const nextSelectedNodeId =
        requestedNodeId &&
        ocdfgData.nodes.some((node) => node.id === requestedNodeId && node.kind === "activity")
          ? requestedNodeId
          : null;
      setOcdfgGraph(ocdfgData);
      setOcpnGraph(ocpnData);
      setOcpnGraphCollapsed(collapseObjects);
      setSelectedNodeId(nextSelectedNodeId);
      setBpmnGraph(null);
      setBpmnError(null);
      persistRunQuery(nextSelectedNodeId);
    } catch (err) {
      replaceQuery({
        pm_run: null,
        pm_node: null,
      });
      setError(err instanceof Error ? err.message : "Failed to load OC-DFG process mining data");
    } finally {
      setLoading(false);
    }
  }, [
    collapseObjects,
    filterPayload,
    minShare,
    modelUri,
    persistRunQuery,
    replaceQuery,
    resolvedFrom,
    resolvedModelUris,
    resolvedTo,
    searchParams,
    traceId,
    workflowId,
  ]);

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

  useEffect(() => {
    if (!isActive) {
      return;
    }
    if (searchParams.get("pm_run") !== "1") {
      autoRunSignatureRef.current = "";
      return;
    }
    if (!modelUri || !resolvedFrom || !resolvedTo || loading || (resolvedDepth > 1 && !ontologyGraph)) {
      return;
    }
    const signature = [
      modelUri,
      depth,
      from,
      to,
      traceId,
      workflowId,
      minShare,
      collapseObjects,
      serializeMiningFilters(filters).join("|"),
    ].join("|");
    if (autoRunSignatureRef.current === signature) {
      return;
    }
    autoRunSignatureRef.current = signature;
    void loadProcessMining();
  }, [
    collapseObjects,
    depth,
    from,
    isActive,
    loadProcessMining,
    loading,
    minShare,
    modelUri,
    ontologyGraph,
    resolvedDepth,
    resolvedFrom,
    resolvedTo,
    searchParams,
    to,
    traceId,
    workflowId,
    filters,
  ]);

  useEffect(() => {
    if (!ocdfgGraph || !selectedNodeId) {
      return;
    }
    const matches = ocdfgGraph.nodes.some((node) => node.id === selectedNodeId);
    if (matches) {
      return;
    }
    setSelectedNodeId(null);
    replaceQuery({ pm_node: null });
  }, [ocdfgGraph, replaceQuery, selectedNodeId]);

  useEffect(() => {
    if (!isActive || loading || !ocdfgGraph) {
      return;
    }
    const signature = [
      modelUri,
      from,
      to,
      depth,
      traceId,
      workflowId,
      minShare,
      collapseObjects,
      serializeMiningFilters(filters).join("|"),
      ocdfgGraph.nodes.length,
      ocdfgGraph.edges.length,
    ].join("|");
    if (completionSignatureRef.current === signature) {
      return;
    }
    completionSignatureRef.current = signature;
    window.requestAnimationFrame(() => {
      resultsSummaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [collapseObjects, depth, filters, from, isActive, loading, minShare, modelUri, ocdfgGraph, to, traceId, workflowId]);

  const selectedNode = useMemo(() => {
    if (!ocdfgGraph || !selectedNodeId) return null;
    return (
      ocdfgGraph.nodes.find(
        node => node.id === selectedNodeId && node.kind === "activity" && Boolean(node.activity)
      ) || null
    );
  }, [ocdfgGraph, selectedNodeId]);

  const selectedNodeStats = useMemo(() => {
    if (!ocdfgGraph || !selectedNodeId) return null;
    const incoming = ocdfgGraph.edges.filter(edge => edge.target === selectedNodeId);
    const outgoing = ocdfgGraph.edges.filter(edge => edge.source === selectedNodeId);
    const incomingTotal = incoming.reduce((sum, edge) => sum + edge.count, 0);
    const outgoingTotal = outgoing.reduce((sum, edge) => sum + edge.count, 0);
    return {
      incoming,
      outgoing,
      incomingTotal,
      outgoingTotal,
    };
  }, [ocdfgGraph, selectedNodeId]);

  const colorForModel = (modelUri: string) => {
    let hash = 0;
    for (let i = 0; i < modelUri.length; i += 1) {
      hash = (hash * 31 + modelUri.charCodeAt(i)) % 360;
    }
    return `hsl(${hash}, 55%, 35%)`;
  };

  const modelLegend = useMemo(() => {
    if (!ocdfgGraph) return [];
    const active = new Set<string>();
    ocdfgGraph.edges.forEach(edge => {
      active.add(edge.objectType);
    });
    return Array.from(active).sort().map(uri => ({
      uri,
      name: modelLabels[uri] ?? ontologyDisplay.displayObjectType(uri),
      color: colorForModel(uri),
    }));
  }, [ocdfgGraph, modelLabels, ontologyDisplay]);

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
    setFilters((current) => current.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  };

  const addFilter = () => {
    setFilters((current) => [...current, { id: `filter-${current.length}`, key: "", value: "" }]);
  };

  const removeFilter = (id: string) => {
    setFilters((current) => {
      const next = current.filter((item) => item.id !== id);
      return next.length > 0 ? next : [{ id: "filter-0", key: "", value: "" }];
    });
  };

  const handleModelChange = (value: string) => {
    setModelUri(value);
    replaceQuery({
      pm_model: value,
      pm_run: null,
      pm_node: null,
    });
  };

  const handleFromChange = (value: string) => {
    setFrom(value);
    setWindowPreset("custom");
    replaceQuery({
      pm_from: value,
      pm_preset: "custom",
      pm_run: null,
      pm_node: null,
    });
  };

  const handleToChange = (value: string) => {
    setTo(value);
    setWindowPreset("custom");
    replaceQuery({
      pm_to: value,
      pm_preset: "custom",
      pm_run: null,
      pm_node: null,
    });
  };

  const handleDepthChange = (value: string) => {
    setDepth(value);
    replaceQuery({
      pm_depth: value,
      pm_run: null,
      pm_node: null,
    });
  };

  const handleTraceIdChange = (value: string) => {
    setTraceId(value);
    replaceQuery({
      pm_trace: value,
      pm_run: null,
      pm_node: null,
    });
  };

  const handleWorkflowIdChange = (value: string) => {
    setWorkflowId(value);
    replaceQuery({
      pm_workflow: value,
      pm_run: null,
      pm_node: null,
    });
  };

  const handleMinShareChange = (value: string) => {
    setMinShare(value);
    replaceQuery({
      pm_min_share: value,
      pm_run: null,
      pm_node: null,
    });
  };

  const handleCollapseObjectsChange = (checked: boolean) => {
    setCollapseObjects(checked);
    replaceQuery({
      pm_collapse: checked ? "1" : "0",
      pm_run: null,
      pm_node: null,
    });
  };

  const handleSelectedNodeChange = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    persistRunQuery(nodeId);
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
            onModelChange={handleModelChange}
            fromId="mining-from"
            fromValue={from}
            onFromChange={handleFromChange}
            toId="mining-to"
            toValue={to}
            onToChange={handleToChange}
            runLabel="Run mining"
            runningLabel="Loading…"
            isRunning={loading}
            runDisabled={!modelUri || loading}
            onRun={loadProcessMining}
            extraControl={
              <div className="space-y-2">
                <Label htmlFor="mining-depth">Depth</Label>
                <Select value={depth} onValueChange={handleDepthChange}>
                  <SelectTrigger id="mining-depth">
                    <SelectValue placeholder="Select depth" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPTH_OPTIONS.map((value) => (
                      <SelectItem key={value} value={value}>
                        Depth {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            }
          />
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-muted/40 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Included object models
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Depth {resolvedDepth} scope from ontology event-sharing relationships.
          </div>
          {includedModels.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {includedModels.map((model) => (
                <Badge
                  key={model.uri}
                  variant={model.isAnchor ? "default" : "outline"}
                  className="rounded-full px-3 py-1 text-[0.65rem] uppercase tracking-[0.15em]"
                >
                  {model.isAnchor ? `Anchor · ${model.name}` : model.name}
                </Badge>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-xs text-muted-foreground">Select an object model to resolve scope.</div>
          )}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="trace">Trace ID (optional)</Label>
            <Input id="trace" placeholder="UUID" value={traceId} onChange={e => handleTraceIdChange(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workflow">Workflow ID (optional)</Label>
            <Input id="workflow" placeholder="UUID" value={workflowId} onChange={e => handleWorkflowIdChange(e.target.value)} />
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
              onChange={e => handleMinShareChange(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="collapseObjects">Secondary OCPN options</Label>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm">
              <input
                id="collapseObjects"
                type="checkbox"
                checked={collapseObjects}
                onChange={e => handleCollapseObjectsChange(e.target.checked)}
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

      {ocdfgGraph && (
        <div ref={resultsSummaryRef}>
          <Card className="rounded-2xl border border-primary/25 bg-card p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Results Ready</p>
                <h2 className="mt-2 font-display text-2xl">Mining completed for {modelLabels[modelUri] ?? "selected model"}</h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  Review the OC-DFG first, then inspect the secondary OCPN and BPMN views if needed.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => ocdfgSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  Jump to OC-DFG
                </Button>
                <Button size="sm" variant="outline" onClick={() => ocpnSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  Jump to OCPN
                </Button>
                <Button size="sm" variant="outline" onClick={() => bpmnSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  Jump to BPMN
                </Button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Included models</p>
                <p className="mt-2 text-sm font-medium">{includedModels.length}</p>
              </div>
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">OC-DFG nodes</p>
                <p className="mt-2 text-sm font-medium">{ocdfgGraph.nodes.length}</p>
              </div>
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">OC-DFG edges</p>
                <p className="mt-2 text-sm font-medium">{ocdfgGraph.edges.length}</p>
              </div>
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Warnings</p>
                <p className="mt-2 text-sm font-medium">{ocdfgGraph.warnings.length}</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      <div ref={ocdfgSectionRef}>
      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Layers className="h-4 w-4" />
          Object-Centric Directly-Follows Graph (Primary)
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            {ocdfgGraph && modelUri ? (
              <OcdfgGraphView
                graph={ocdfgGraph}
                modelLabels={modelLabels}
                eventLabels={ocdfgEventLabels}
                selectedNodeId={selectedNodeId}
                onNodeSelect={handleSelectedNodeChange}
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
                    {ontologyDisplay.displayEventType(selectedNode.activity ?? "")}
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
        {ocdfgGraph && ocdfgGraph.edges.length === 0 && (
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
      </div>

      <div ref={ocpnSectionRef}>
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
      </div>

      <div ref={bpmnSectionRef}>
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
    </div>
  );
}
