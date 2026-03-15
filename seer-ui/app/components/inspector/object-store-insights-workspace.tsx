"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Label } from "../ui/label";
import { SearchableSelect } from "../ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Table } from "../ui/table";
import type { SharedWindowPreset } from "./inspector-scope-filters";
import { OcdfgGraph as OcdfgGraphView } from "./ocdfg-graph";
import {
  buildRuntimeOutcomeOptions,
  resolveRuntimeDepthScopedModels,
} from "./ontology-runtime-semantics";

import { useOntologyGraphContext } from "@/app/components/providers/ontology-graph-provider";
import { getOcdfgGraph } from "@/app/lib/api/process-mining";
import { runRootCause } from "@/app/lib/api/root-cause";
import { useOntologyDisplay } from "@/app/lib/ontology-display";
import { mergeSearchParams } from "@/app/lib/url-state";
import { cn } from "@/app/lib/utils";
import type { OntologyGraph } from "@/app/types/ontology";
import type { OcdfgGraph } from "@/app/types/process-mining";
import type {
  RootCauseInsightResultContract,
  RootCauseRunResponseContract,
} from "@/app/types/root-cause";

const DEPTH_OPTIONS = ["1", "2", "3"];
const OUTCOME_SENTINEL = "__select_outcome__";

function toDatetimeLocalValue(date: Date): string {
  const withOffset = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return withOffset.toISOString().slice(0, 16);
}

function defaultWindowRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: toDatetimeLocalValue(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
    to: toDatetimeLocalValue(now),
  };
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

function buildOutcomeOptions(
  graph: OntologyGraph | null,
  anchorModelUri: string,
  displayEventType: (eventType: string) => string
): Array<{ value: string; label: string; source: string }> {
  return buildRuntimeOutcomeOptions({ graph, anchorModelUri, displayEventType });
}

function resolveDepthScopedModels(options: {
  anchorModelUri: string;
  depth: number;
  graph: OntologyGraph | null;
  knownModelUris: Set<string>;
}): string[] {
  return resolveRuntimeDepthScopedModels(options);
}

function toPercent(value: number): string {
  return `${(Math.max(0, value) * 100).toFixed(2)}%`;
}

function isAnchorOnlyInsight(insight: RootCauseInsightResultContract | null): boolean {
  if (!insight || insight.conditions.length === 0) {
    return false;
  }
  return insight.conditions.every((condition) => condition.feature.startsWith("anchor."));
}

function graphEventLabels(
  graph: OcdfgGraph | null,
  displayEventType: (eventType: string) => string
): Record<string, string> {
  if (!graph) {
    return {};
  }
  return graph.nodes.reduce<Record<string, string>>((acc, node) => {
    if (node.kind !== "activity" || !node.activity) {
      return acc;
    }
    acc[node.activity] = displayEventType(node.activity);
    return acc;
  }, {});
}

interface ObjectStoreInsightsWorkspaceProps {
  objectType: string;
  isActive: boolean;
}

export function ObjectStoreInsightsWorkspace({
  objectType,
  isActive,
}: ObjectStoreInsightsWorkspaceProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const ontologyDisplay = useOntologyDisplay();
  const { graph: ontologyGraph } = useOntologyGraphContext();

  const [windowPreset, setWindowPreset] = useState<SharedWindowPreset>(() => {
    const preset = searchParams.get("os_preset");
    return preset === "7d" || preset === "30d" || preset === "custom" ? preset : "24h";
  });
  const [from, setFrom] = useState(() =>
    normalizeDateTimeLocalValue(searchParams.get("os_from"), defaultWindowRange().from)
  );
  const [to, setTo] = useState(() =>
    normalizeDateTimeLocalValue(searchParams.get("os_to"), defaultWindowRange().to)
  );
  const [depth, setDepth] = useState(() => {
    const raw = searchParams.get("os_depth");
    return DEPTH_OPTIONS.includes(raw ?? "") ? (raw as string) : "1";
  });
  const [outcomeEventType, setOutcomeEventType] = useState(() => searchParams.get("os_outcome") ?? "");

  const [primaryGraph, setPrimaryGraph] = useState<OcdfgGraph | null>(null);
  const [primaryLoading, setPrimaryLoading] = useState(false);
  const [primaryError, setPrimaryError] = useState<string | null>(null);
  const [primarySelectedNodeId, setPrimarySelectedNodeId] = useState<string | null>(null);

  const [runState, setRunState] = useState<"idle" | "running" | "completed" | "error">("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [run, setRun] = useState<RootCauseRunResponseContract | null>(null);
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(() => searchParams.get("os_rca_insight"));

  const [comparisonGraph, setComparisonGraph] = useState<OcdfgGraph | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonSelectedNodeId, setComparisonSelectedNodeId] = useState<string | null>(null);

  const primarySignatureRef = useRef("");
  const rcaSignatureRef = useRef("");
  const comparisonSignatureRef = useRef("");

  const modelOptions = useMemo(
    () =>
      [...ontologyDisplay.catalog.objectModels]
        .map((model) => ({
          uri: model.uri,
          name: ontologyDisplay.displayObjectType(model.uri),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [ontologyDisplay]
  );
  const modelLabels = useMemo(
    () =>
      modelOptions.reduce<Record<string, string>>((acc, option) => {
        acc[option.uri] = option.name;
        return acc;
      }, {}),
    [modelOptions]
  );

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

  const clearRcaState = useCallback(() => {
    setRunState("idle");
    setRunError(null);
    setRun(null);
    setSelectedInsightId(null);
    setComparisonGraph(null);
    setComparisonError(null);
    setComparisonSelectedNodeId(null);
    comparisonSignatureRef.current = "";
    rcaSignatureRef.current = "";
  }, []);

  useEffect(() => {
    const fallbackWindow = defaultWindowRange();
    const nextPreset = searchParams.get("os_preset");
    const nextWindowPreset =
      nextPreset === "7d" || nextPreset === "30d" || nextPreset === "custom" ? nextPreset : "24h";
    const nextDepth = DEPTH_OPTIONS.includes(searchParams.get("os_depth") ?? "")
      ? (searchParams.get("os_depth") as string)
      : "1";
    const nextOutcome = searchParams.get("os_outcome") ?? "";
    const nextSelectedInsightId = searchParams.get("os_rca_insight");
    const nextRunRequested = searchParams.get("os_rca_run") === "1";

    setWindowPreset((current) => (current === nextWindowPreset ? current : nextWindowPreset));
    setFrom((current) => {
      const nextFrom = normalizeDateTimeLocalValue(searchParams.get("os_from"), fallbackWindow.from);
      return current === nextFrom ? current : nextFrom;
    });
    setTo((current) => {
      const nextTo = normalizeDateTimeLocalValue(searchParams.get("os_to"), fallbackWindow.to);
      return current === nextTo ? current : nextTo;
    });
    setDepth((current) => (current === nextDepth ? current : nextDepth));
    setOutcomeEventType((current) => (current === nextOutcome ? current : nextOutcome));
    setSelectedInsightId((current) => (current === nextSelectedInsightId ? current : nextSelectedInsightId));

    if (!nextRunRequested) {
      clearRcaState();
    }
  }, [clearRcaState, searchParams]);

  const selectedModel = useMemo(
    () => modelOptions.find((model) => model.uri === objectType) || null,
    [modelOptions, objectType]
  );
  const anchorObjectType = selectedModel?.uri || objectType;
  const displayEventType = useCallback(
    (eventType: string) =>
      ontologyDisplay.displayEventType(eventType, {
        fallbackObjectType: anchorObjectType || undefined,
      }),
    [anchorObjectType, ontologyDisplay]
  );
  const outcomeOptions = useMemo(
    () => buildOutcomeOptions(ontologyGraph, anchorObjectType, displayEventType),
    [anchorObjectType, displayEventType, ontologyGraph]
  );

  const searchableOutcomeOptions = useMemo(() => {
    const options = outcomeOptions.map((option) => ({
      value: option.value,
      label: option.label,
      description: option.source,
    }));
    if (
      outcomeEventType &&
      !options.some((option) => option.value === outcomeEventType)
    ) {
      options.unshift({
        value: outcomeEventType,
        label: displayEventType(outcomeEventType),
        description: "Current selection",
      });
    }
    return options;
  }, [displayEventType, outcomeEventType, outcomeOptions]);

  const resolvedDepth = useMemo(() => {
    const parsed = Number.parseInt(depth, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }, [depth]);
  const knownModelUris = useMemo(() => new Set(modelOptions.map((option) => option.uri)), [modelOptions]);
  const resolvedModelUris = useMemo(() => {
    return resolveDepthScopedModels({
      anchorModelUri: anchorObjectType,
      depth: resolvedDepth,
      graph: ontologyGraph,
      knownModelUris,
    });
  }, [anchorObjectType, knownModelUris, ontologyGraph, resolvedDepth]);

  const resolvedFrom = useMemo(() => toIsoDateTime(from), [from]);
  const resolvedTo = useMemo(() => toIsoDateTime(to), [to]);

  const selectedInsight = useMemo(() => {
    if (!run) {
      return null;
    }
    if (!selectedInsightId) {
      return run.insights[0] || null;
    }
    return run.insights.find((insight) => insight.insight_id === selectedInsightId) || run.insights[0] || null;
  }, [run, selectedInsightId]);
  const comparisonSupported = useMemo(() => isAnchorOnlyInsight(selectedInsight), [selectedInsight]);

  const persistScopeQuery = useCallback((updates: Record<string, string | null | undefined>) => {
    replaceQuery({
      os_preset: windowPreset,
      os_from: from,
      os_to: to,
      os_depth: depth,
      os_outcome: outcomeEventType || null,
      ...updates,
    });
  }, [depth, from, outcomeEventType, replaceQuery, to, windowPreset]);

  const loadPrimaryGraph = useCallback(async () => {
    if (!anchorObjectType || !resolvedFrom || !resolvedTo) {
      return;
    }
    if (resolvedFrom > resolvedTo) {
      setPrimaryError("The start time must be earlier than the end time.");
      setPrimaryGraph(null);
      return;
    }
    setPrimaryLoading(true);
    setPrimaryError(null);
    try {
      const ocdfgData = await getOcdfgGraph({
        modelUri: anchorObjectType,
        modelUris: resolvedModelUris,
        from: resolvedFrom,
        to: resolvedTo,
      });
      setPrimaryGraph(ocdfgData);
    } catch (error) {
      setPrimaryGraph(null);
      setPrimaryError(error instanceof Error ? error.message : "Failed to load OC-DFG.");
    } finally {
      setPrimaryLoading(false);
    }
  }, [anchorObjectType, resolvedFrom, resolvedModelUris, resolvedTo]);

  const loadComparisonGraph = useCallback(async (insight: RootCauseInsightResultContract) => {
    if (!anchorObjectType || !resolvedFrom || !resolvedTo) {
      return;
    }
    if (!isAnchorOnlyInsight(insight)) {
      setComparisonGraph(null);
      setComparisonError(null);
      return;
    }

    setComparisonLoading(true);
    setComparisonError(null);
    try {
      const ocdfgData = await getOcdfgGraph({
        modelUri: anchorObjectType,
        modelUris: resolvedModelUris,
        from: resolvedFrom,
        to: resolvedTo,
        anchorFilters: insight.conditions.map((condition) => ({
          field: condition.feature,
          op: condition.op,
          value: condition.value,
        })),
      });
      setComparisonGraph(ocdfgData);
    } catch (error) {
      setComparisonGraph(null);
      setComparisonError(
        error instanceof Error ? error.message : "Failed to load comparison OC-DFG."
      );
    } finally {
      setComparisonLoading(false);
    }
  }, [anchorObjectType, resolvedFrom, resolvedModelUris, resolvedTo]);

  const runAnalysis = useCallback(async () => {
    if (!anchorObjectType) {
      setRunError("Select an object model before running RCA.");
      setRunState("error");
      return;
    }
    if (!outcomeEventType.trim()) {
      setRunError("Outcome event type is required.");
      setRunState("error");
      return;
    }
    if (!resolvedFrom || !resolvedTo) {
      setRunError("Select a valid time window before running RCA.");
      setRunState("error");
      return;
    }
    if (resolvedFrom > resolvedTo) {
      setRunError("The start time must be earlier than the end time.");
      setRunState("error");
      return;
    }

    setRunState("running");
    setRunError(null);
    setComparisonGraph(null);
    setComparisonError(null);
    try {
      const response = await runRootCause({
        anchor_object_type: anchorObjectType,
        start_at: resolvedFrom,
        end_at: resolvedTo,
        depth: resolvedDepth,
        outcome: {
          event_type: outcomeEventType.trim(),
          object_type: anchorObjectType,
        },
      });
      const preferredInsight =
        response.insights.find((insight) => insight.insight_id === searchParams.get("os_rca_insight")) ||
        response.insights[0] ||
        null;
      setRun(response);
      setRunState("completed");
      setSelectedInsightId(preferredInsight?.insight_id ?? null);
      persistScopeQuery({
        os_rca_run: "1",
        os_rca_insight: preferredInsight?.insight_id ?? null,
      });
    } catch (error) {
      setRun(null);
      setRunState("error");
      setRunError(error instanceof Error ? error.message : "Root-cause analysis failed.");
      persistScopeQuery({
        os_rca_run: null,
        os_rca_insight: null,
      });
    }
  }, [
    anchorObjectType,
    outcomeEventType,
    persistScopeQuery,
    resolvedDepth,
    resolvedFrom,
    resolvedTo,
    searchParams,
  ]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    if (!anchorObjectType || !resolvedFrom || !resolvedTo || (resolvedDepth > 1 && !ontologyGraph)) {
      return;
    }
    const signature = [
      anchorObjectType,
      resolvedDepth,
      from,
      to,
      resolvedModelUris.join("|"),
    ].join("|");
    if (primarySignatureRef.current === signature) {
      return;
    }
    primarySignatureRef.current = signature;
    void loadPrimaryGraph();
  }, [
    anchorObjectType,
    from,
    isActive,
    loadPrimaryGraph,
    ontologyGraph,
    resolvedDepth,
    resolvedFrom,
    resolvedModelUris,
    resolvedTo,
    to,
  ]);

  useEffect(() => {
    if (!isActive || searchParams.get("os_rca_run") !== "1" || runState === "running") {
      return;
    }
    if (!anchorObjectType || !outcomeEventType.trim() || !resolvedFrom || !resolvedTo) {
      return;
    }
    const signature = [
      anchorObjectType,
      resolvedDepth,
      from,
      to,
      outcomeEventType,
    ].join("|");
    if (rcaSignatureRef.current === signature) {
      return;
    }
    rcaSignatureRef.current = signature;
    void runAnalysis();
  }, [
    anchorObjectType,
    from,
    isActive,
    outcomeEventType,
    resolvedDepth,
    resolvedFrom,
    resolvedTo,
    runAnalysis,
    runState,
    searchParams,
    to,
  ]);

  useEffect(() => {
    if (!selectedInsight || !run || !isActive) {
      comparisonSignatureRef.current = "";
      return;
    }
    if (!comparisonSupported) {
      setComparisonGraph(null);
      setComparisonError(null);
      comparisonSignatureRef.current = "";
      return;
    }
    const signature = `${selectedInsight.insight_id}|${selectedInsight.conditions.map((item) => `${item.feature}:${item.value}`).join("|")}`;
    if (comparisonSignatureRef.current === signature) {
      return;
    }
    comparisonSignatureRef.current = signature;
    void loadComparisonGraph(selectedInsight);
  }, [comparisonSupported, isActive, loadComparisonGraph, run, selectedInsight]);

  const applyWindowPreset = (preset: Exclude<SharedWindowPreset, "custom">) => {
    const now = new Date();
    const durationMsByPreset: Record<Exclude<SharedWindowPreset, "custom">, number> = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };
    const start = new Date(now.getTime() - durationMsByPreset[preset]);
    const nextFrom = toDatetimeLocalValue(start);
    const nextTo = toDatetimeLocalValue(now);
    setWindowPreset(preset);
    setFrom(nextFrom);
    setTo(nextTo);
    clearRcaState();
    persistScopeQuery({
      os_preset: preset,
      os_from: nextFrom,
      os_to: nextTo,
      os_rca_run: null,
      os_rca_insight: null,
    });
  };

  const handleFromChange = (value: string) => {
    setWindowPreset("custom");
    setFrom(value);
    clearRcaState();
    persistScopeQuery({
      os_preset: "custom",
      os_from: value,
      os_rca_run: null,
      os_rca_insight: null,
    });
  };

  const handleToChange = (value: string) => {
    setWindowPreset("custom");
    setTo(value);
    clearRcaState();
    persistScopeQuery({
      os_preset: "custom",
      os_to: value,
      os_rca_run: null,
      os_rca_insight: null,
    });
  };

  const handleDepthChange = (value: string) => {
    setDepth(value);
    clearRcaState();
    persistScopeQuery({
      os_depth: value,
      os_rca_run: null,
      os_rca_insight: null,
    });
  };

  const handleOutcomeChange = (value: string) => {
    const nextValue = value === OUTCOME_SENTINEL ? "" : value;
    setOutcomeEventType(nextValue);
    clearRcaState();
    persistScopeQuery({
      os_outcome: nextValue || null,
      os_rca_run: null,
      os_rca_insight: null,
    });
  };

  const handleSelectInsight = (insight: RootCauseInsightResultContract) => {
    setSelectedInsightId(insight.insight_id);
    setComparisonSelectedNodeId(null);
    persistScopeQuery({
      os_rca_run: run ? "1" : null,
      os_rca_insight: insight.insight_id,
    });
  };

  const primaryEventLabels = useMemo(
    () => graphEventLabels(primaryGraph, displayEventType),
    [displayEventType, primaryGraph]
  );
  const comparisonEventLabels = useMemo(
    () => graphEventLabels(comparisonGraph, displayEventType),
    [comparisonGraph, displayEventType]
  );

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={windowPreset === "24h" ? "secondary" : "outline"}
            onClick={() => applyWindowPreset("24h")}
          >
            Last 24h
          </Button>
          <Button
            type="button"
            size="sm"
            variant={windowPreset === "7d" ? "secondary" : "outline"}
            onClick={() => applyWindowPreset("7d")}
          >
            Last 7d
          </Button>
          <Button
            type="button"
            size="sm"
            variant={windowPreset === "30d" ? "secondary" : "outline"}
            onClick={() => applyWindowPreset("30d")}
          >
            Last 30d
          </Button>
          <Badge variant="outline" className="ml-auto">
            {selectedModel?.name || ontologyDisplay.displayObjectType(objectType)}
          </Badge>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_220px_1.2fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="os-from">From</Label>
            <input
              id="os-from"
              type="datetime-local"
              value={from}
              onChange={(event) => handleFromChange(event.target.value)}
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="os-to">To</Label>
            <input
              id="os-to"
              type="datetime-local"
              value={to}
              onChange={(event) => handleToChange(event.target.value)}
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="os-depth">Depth</Label>
            <Select value={depth} onValueChange={handleDepthChange}>
              <SelectTrigger id="os-depth">
                <SelectValue />
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

          <div className="space-y-2">
            <Label htmlFor="os-outcome">Outcome event</Label>
            <SearchableSelect
              triggerId="os-outcome"
              value={outcomeEventType || OUTCOME_SENTINEL}
              onValueChange={handleOutcomeChange}
              groups={[
                {
                  label: "Outcome event types",
                  options: [
                    { value: OUTCOME_SENTINEL, label: "Select event type" },
                    ...searchableOutcomeOptions,
                  ],
                },
              ]}
              placeholder="Select event type"
              searchPlaceholder="Search event types..."
              emptyMessage="No event types found."
            />
          </div>

          <div className="flex items-end">
            <Button className="w-full" onClick={runAnalysis} disabled={runState === "running"}>
              {runState === "running" ? "Running RCA..." : "Run RCA"}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{resolvedModelUris.length} included models in the OC-DFG scope.</span>
          <span>Primary OC-DFG reruns automatically when time or depth changes.</span>
          {outcomeOptions.length > 0 ? <span>{outcomeOptions.length} outcome options resolved from ontology.</span> : null}
        </div>

        {(primaryError || runError) && (
          <div className="mt-4 space-y-2">
            {primaryError ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {primaryError}
              </div>
            ) : null}
            {runError ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {runError}
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {!run ? (
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Scoped Baseline
              </p>
              <h2 className="mt-2 font-display text-2xl">Object-Centric Flow Graph</h2>
            </div>
            <Badge variant="outline">{primaryLoading ? "Refreshing..." : "Auto-run"}</Badge>
          </div>
          <div className="mt-5">
            {primaryGraph ? (
              <OcdfgGraphView
                graph={primaryGraph}
                modelLabels={modelLabels}
                eventLabels={primaryEventLabels}
                selectedNodeId={primarySelectedNodeId}
                onNodeSelect={setPrimarySelectedNodeId}
              />
            ) : (
              <div className="flex h-[680px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
                {primaryLoading ? "Loading OC-DFG..." : "No OC-DFG available for the current scope."}
              </div>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.35fr)]">
          <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                RCA Results
              </div>
              <Badge variant="outline">{run.insights.length} insights</Badge>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Cohort size</p>
                <p className="mt-2 text-sm font-medium">{run.cohort_size}</p>
              </div>
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Positives</p>
                <p className="mt-2 text-sm font-medium">{run.positive_count}</p>
              </div>
            </div>
            <Table.Root className="mt-4" variant="surface" striped>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Hypothesis</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="text-right">Lift</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="text-right">Coverage</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {run.insights.map((insight) => {
                  const supported = isAnchorOnlyInsight(insight);
                  const isSelected = selectedInsight?.insight_id === insight.insight_id;
                  return (
                    <Table.Row
                      key={insight.insight_id}
                      className={cn("cursor-pointer", isSelected && "bg-accent")}
                      onClick={() => handleSelectInsight(insight)}
                    >
                      <Table.RowHeaderCell>
                        <div className="max-w-[360px] truncate">
                          {insight.rank}. {insight.title}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>support {insight.score.support}</span>
                          <Badge variant={supported ? "outline" : "secondary"} className="rounded-full px-2 py-0 text-[10px]">
                            {supported ? "Graph compare ready" : "Anchor-only compare"}
                          </Badge>
                        </div>
                      </Table.RowHeaderCell>
                      <Table.Cell className="text-right text-xs">{insight.score.lift.toFixed(2)}</Table.Cell>
                      <Table.Cell className="text-right text-xs">{toPercent(insight.score.coverage)}</Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          </Card>

          <div className="space-y-6">
            <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Baseline OC-DFG
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Current scope for {selectedModel?.name || ontologyDisplay.displayObjectType(objectType)}.
                  </p>
                </div>
                <Badge variant="outline">{primaryLoading ? "Refreshing..." : "Baseline"}</Badge>
              </div>
              <div className="mt-5">
                {primaryGraph ? (
                  <OcdfgGraphView
                    graph={primaryGraph}
                    modelLabels={modelLabels}
                    eventLabels={primaryEventLabels}
                    selectedNodeId={primarySelectedNodeId}
                    onNodeSelect={setPrimarySelectedNodeId}
                    heightClass="h-[360px]"
                  />
                ) : (
                  <div className="flex h-[360px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
                    {primaryLoading ? "Loading OC-DFG..." : "No OC-DFG available for the current scope."}
                  </div>
                )}
              </div>
            </Card>

            <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Selected RCA Comparison
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {selectedInsight ? selectedInsight.title : "Select an RCA result to compare."}
                  </p>
                </div>
                {selectedInsight ? (
                  <Badge variant={comparisonSupported ? "outline" : "secondary"}>
                    {comparisonSupported ? "Anchor-filter graph" : "Unsupported rule family"}
                  </Badge>
                ) : null}
              </div>

              <div className="mt-5">
                {!selectedInsight ? (
                  <div className="flex h-[360px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
                    Select an RCA result to load the comparison graph.
                  </div>
                ) : !comparisonSupported ? (
                  <div className="flex h-[360px] items-center justify-center rounded-2xl border border-dashed border-border px-6 text-center text-sm text-muted-foreground">
                    Comparison graph currently supports anchor-field RCA rules only. This result includes non-anchor RCA conditions.
                  </div>
                ) : comparisonError ? (
                  <div className="flex h-[360px] items-center justify-center rounded-2xl border border-destructive/40 bg-destructive/10 px-6 text-center text-sm text-destructive">
                    {comparisonError}
                  </div>
                ) : comparisonGraph ? (
                  <OcdfgGraphView
                    graph={comparisonGraph}
                    modelLabels={modelLabels}
                    eventLabels={comparisonEventLabels}
                    selectedNodeId={comparisonSelectedNodeId}
                    onNodeSelect={setComparisonSelectedNodeId}
                    heightClass="h-[360px]"
                  />
                ) : (
                  <div className="flex h-[360px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
                    {comparisonLoading ? "Loading comparison OC-DFG..." : "No comparison OC-DFG available."}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
