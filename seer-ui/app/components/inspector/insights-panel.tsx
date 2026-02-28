"use client";

import { useEffect, useMemo, useState } from "react";
import { DataList } from "@radix-ui/themes";
import { Clock3, Filter, Link2, Sparkles, Workflow } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Table } from "../ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

import { cn } from "@/app/lib/utils";
import { getOntologyGraph } from "@/app/lib/api/ontology";
import {
  getProcessTraceDrilldown,
  mineProcess,
  type ProcessMineResponseContract,
  type ProcessTraceDrilldownResponseContract,
} from "@/app/lib/api/process-mining";

type RunState = "idle" | "queued" | "running" | "completed" | "error";
type WindowPreset = "24h" | "7d" | "30d" | "custom";
type InsightKind = "path" | "edge" | "node";

interface InsightItem {
  id: string;
  kind: InsightKind;
  title: string;
  subtitle: string;
  count: number;
  share: number;
  handle: string;
}

interface ModelOption {
  uri: string;
  name: string;
}

function toDatetimeLocalValue(date: Date): string {
  const withOffset = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return withOffset.toISOString().slice(0, 16);
}

function toRoundedPercent(value: number): string {
  return `${(Math.max(0, value) * 100).toFixed(1)}%`;
}

function parsePositiveInteger(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function iriLocalName(iri: string): string {
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

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return "—";
  }
  return parsed.toLocaleString();
}

function buildPathInsights(run: ProcessMineResponseContract): InsightItem[] {
  const total = run.path_stats.reduce((sum, path) => sum + (Number(path.count) || 0), 0);
  return [...run.path_stats]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((path) => ({
      id: `path:${path.object_type}:${path.path}`,
      kind: "path",
      title: path.path,
      subtitle: path.object_type,
      count: path.count,
      share: total > 0 ? path.count / total : 0,
      handle: path.trace_handle,
    }));
}

function buildEdgeInsights(run: ProcessMineResponseContract): InsightItem[] {
  const total = run.edges.reduce((sum, edge) => sum + (Number(edge.count) || 0), 0);
  return [...run.edges]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((edge) => ({
      id: `edge:${edge.id}`,
      kind: "edge",
      title: `${edge.source.replace(/^event:/, "")} -> ${edge.target.replace(/^event:/, "")}`,
      subtitle: edge.object_type,
      count: edge.count,
      share: total > 0 ? edge.count / total : 0,
      handle: edge.trace_handle,
    }));
}

function buildNodeInsights(run: ProcessMineResponseContract): InsightItem[] {
  const total = run.nodes.reduce((sum, node) => sum + (Number(node.frequency) || 0), 0);
  return [...run.nodes]
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 8)
    .map((node) => ({
      id: `node:${node.id}`,
      kind: "node",
      title: node.label,
      subtitle: node.node_type,
      count: node.frequency,
      share: total > 0 ? node.frequency / total : 0,
      handle: node.trace_handle,
    }));
}

export function InsightsPanel() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [anchorModelUri, setAnchorModelUri] = useState("");
  const [includeModelUris, setIncludeModelUris] = useState<string[]>([]);

  const [windowPreset, setWindowPreset] = useState<WindowPreset>("24h");
  const [from, setFrom] = useState(() => {
    const now = new Date();
    return toDatetimeLocalValue(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  });
  const [to, setTo] = useState(() => toDatetimeLocalValue(new Date()));

  const [maxEvents, setMaxEvents] = useState("");
  const [maxRelations, setMaxRelations] = useState("");
  const [maxTracesPerHandle, setMaxTracesPerHandle] = useState("");
  const [traceLimit, setTraceLimit] = useState("25");

  const [runState, setRunState] = useState<RunState>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [run, setRun] = useState<ProcessMineResponseContract | null>(null);

  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<ProcessTraceDrilldownResponseContract | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getOntologyGraph()
      .then((graph) => {
        if (!active) {
          return;
        }
        const modelOptions = graph.nodes
          .filter((node) => node.label === "ObjectModel")
          .map((node) => ({
            uri: node.uri,
            name: (node.properties?.name as string) || iriLocalName(node.uri),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        setModels(modelOptions);
        if (!anchorModelUri && modelOptions.length > 0) {
          setAnchorModelUri(modelOptions[0].uri);
        }
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setModels([]);
      });

    return () => {
      active = false;
    };
  }, [anchorModelUri]);

  const modelNameByUri = useMemo(() => {
    return models.reduce<Record<string, string>>((acc, model) => {
      acc[model.uri] = model.name;
      return acc;
    }, {});
  }, [models]);

  const selectedModelUris = useMemo(() => {
    const merged = [anchorModelUri, ...includeModelUris].filter(Boolean);
    return Array.from(new Set(merged));
  }, [anchorModelUri, includeModelUris]);

  const pathInsights = useMemo(() => (run ? buildPathInsights(run) : []), [run]);
  const edgeInsights = useMemo(() => (run ? buildEdgeInsights(run) : []), [run]);
  const nodeInsights = useMemo(() => (run ? buildNodeInsights(run) : []), [run]);
  const allInsights = useMemo(
    () => [...pathInsights, ...edgeInsights, ...nodeInsights],
    [pathInsights, edgeInsights, nodeInsights]
  );

  const selectedInsight = useMemo(
    () => allInsights.find((insight) => insight.id === selectedInsightId) || allInsights[0] || null,
    [allInsights, selectedInsightId]
  );

  const objectTypeCounts = useMemo(() => {
    if (!run) {
      return [];
    }
    const counts = new Map<string, number>();
    run.edges.forEach((edge) => {
      counts.set(edge.object_type, (counts.get(edge.object_type) || 0) + edge.count);
    });
    return Array.from(counts.entries())
      .map(([objectType, count]) => ({ objectType, count }))
      .sort((a, b) => b.count - a.count);
  }, [run]);

  const runSummary = useMemo(() => {
    if (!run) {
      return null;
    }
    const totalNodeFrequency = run.nodes.reduce((sum, node) => sum + node.frequency, 0);
    const totalEdgeCount = run.edges.reduce((sum, edge) => sum + edge.count, 0);
    return {
      totalNodeFrequency,
      totalEdgeCount,
      pathCount: run.path_stats.length,
      warningsCount: run.warnings.length,
    };
  }, [run]);

  const loadTraceEvidence = async (insight: InsightItem, limitOverride?: number) => {
    const limit = limitOverride || parsePositiveInteger(traceLimit) || 25;
    setEvidenceLoading(true);
    setEvidenceError(null);
    try {
      const response = await getProcessTraceDrilldown(insight.handle, limit);
      setEvidence(response);
    } catch (error) {
      setEvidence(null);
      setEvidenceError(error instanceof Error ? error.message : "Failed to load trace evidence.");
    } finally {
      setEvidenceLoading(false);
    }
  };

  const applyPreset = (preset: WindowPreset) => {
    setWindowPreset(preset);
    if (preset === "custom") {
      return;
    }
    const now = new Date();
    const durationMsByPreset: Record<Exclude<WindowPreset, "custom">, number> = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };
    const start = new Date(now.getTime() - durationMsByPreset[preset]);
    setFrom(toDatetimeLocalValue(start));
    setTo(toDatetimeLocalValue(now));
  };

  const toggleIncludedModel = (uri: string, checked: boolean) => {
    setIncludeModelUris((prev) => {
      if (checked) {
        return Array.from(new Set([...prev, uri]));
      }
      return prev.filter((value) => value !== uri);
    });
  };

  const runMining = async () => {
    if (!anchorModelUri) {
      setRunError("Select an object model before running insights.");
      setRunState("error");
      return;
    }

    setRunState("queued");
    setRunError(null);
    setEvidence(null);
    setEvidenceError(null);
    setSelectedInsightId(null);

    setTimeout(() => setRunState("running"), 0);

    try {
      const nextRun = await mineProcess({
        modelUri: anchorModelUri,
        modelUris: selectedModelUris,
        from: from || undefined,
        to: to || undefined,
        maxEvents: parsePositiveInteger(maxEvents),
        maxRelations: parsePositiveInteger(maxRelations),
        maxTracesPerHandle: parsePositiveInteger(maxTracesPerHandle),
      });
      const nextInsights = [
        ...buildPathInsights(nextRun),
        ...buildEdgeInsights(nextRun),
        ...buildNodeInsights(nextRun),
      ];
      const firstInsight = nextInsights[0] || null;
      setRun(nextRun);
      if (firstInsight) {
        setSelectedInsightId(firstInsight.id);
        void loadTraceEvidence(firstInsight, parsePositiveInteger(traceLimit) || 25);
      } else {
        setSelectedInsightId(null);
      }
      setRunState("completed");
    } catch (error) {
      setRun(null);
      setRunState("error");
      setRunError(error instanceof Error ? error.message : "Failed to run process insights.");
    }
  };

  const selectInsight = (insight: InsightItem) => {
    setSelectedInsightId(insight.id);
    void loadTraceEvidence(insight);
  };

  const onTraceLimitChange = (value: string) => {
    setTraceLimit(value);
    if (!selectedInsight) {
      return;
    }
    const parsedLimit = parsePositiveInteger(value) || 25;
    void loadTraceEvidence(selectedInsight, parsedLimit);
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Insights</p>
            <h1 className="mt-3 font-display text-3xl">Process Intelligence Workbench</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Run full object-centric mining from canonical process APIs, rank dominant patterns,
              and open trace evidence for each finding.
            </p>
          </div>
          <Badge className="gap-2 rounded-full bg-muted px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em]">
            <Sparkles className="h-3 w-3" />
            Canonical Mine + Traces
          </Badge>
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Filter className="h-4 w-4" />
          Run Controls
        </div>

        <Tabs defaultValue="scope" className="mt-4 space-y-4">
          <TabsList className="h-10">
            <TabsTrigger value="scope">Scope</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          <TabsContent value="scope" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr_1fr_1fr_0.6fr]">
              <div className="space-y-2">
                <Label htmlFor="anchor-model">Anchor object model</Label>
                <Select value={anchorModelUri} onValueChange={setAnchorModelUri}>
                  <SelectTrigger id="anchor-model">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((model) => (
                      <SelectItem key={model.uri} value={model.uri}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="window-preset">Window</Label>
                <Select value={windowPreset} onValueChange={(value) => applyPreset(value as WindowPreset)}>
                  <SelectTrigger id="window-preset">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24h">Last 24h</SelectItem>
                    <SelectItem value="7d">Last 7d</SelectItem>
                    <SelectItem value="30d">Last 30d</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="from">From</Label>
                <Input
                  id="from"
                  type="datetime-local"
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value);
                    setWindowPreset("custom");
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="to">To</Label>
                <Input
                  id="to"
                  type="datetime-local"
                  value={to}
                  onChange={(event) => {
                    setTo(event.target.value);
                    setWindowPreset("custom");
                  }}
                />
              </div>

              <div className="flex items-end">
                <Button className="w-full" onClick={runMining} disabled={!anchorModelUri || runState === "running"}>
                  {runState === "running" || runState === "queued" ? "Running..." : "Run insights"}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="max-events">Max events (optional)</Label>
                <Input
                  id="max-events"
                  type="number"
                  min={1}
                  placeholder="uses backend default"
                  value={maxEvents}
                  onChange={(event) => setMaxEvents(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-relations">Max relations (optional)</Label>
                <Input
                  id="max-relations"
                  type="number"
                  min={1}
                  placeholder="uses backend default"
                  value={maxRelations}
                  onChange={(event) => setMaxRelations(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-traces">Max traces per handle (optional)</Label>
                <Input
                  id="max-traces"
                  type="number"
                  min={1}
                  placeholder="uses backend default"
                  value={maxTracesPerHandle}
                  onChange={(event) => setMaxTracesPerHandle(event.target.value)}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-muted/35 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Include additional object models
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Anchor model is always included. Add related object models to widen the mining scope.
              </p>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {models
                  .filter((model) => model.uri !== anchorModelUri)
                  .map((model) => {
                    const checked = includeModelUris.includes(model.uri);
                    return (
                      <label
                        key={model.uri}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm",
                          checked ? "border-primary/45 bg-primary/10" : "border-border bg-background"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => toggleIncludedModel(model.uri, event.target.checked)}
                        />
                        <span className="truncate">{model.name}</span>
                      </label>
                    );
                  })}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={runState === "error" ? "destructive" : "outline"}>{runState}</Badge>
          <span className="text-muted-foreground">
            {selectedModelUris.length} model{selectedModelUris.length === 1 ? "" : "s"} in scope
          </span>
        </div>

        {runError && (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {runError}
          </div>
        )}
      </Card>

      {run && (
        <>
          <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Run ID</p>
                <p className="mt-2 truncate font-mono text-xs">{run.run_id}</p>
              </div>
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Anchor Type</p>
                <p className="mt-2 text-sm font-medium">{run.anchor_object_type}</p>
              </div>
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Window</p>
                <p className="mt-2 text-sm">{formatDateTime(run.start_at)} - {formatDateTime(run.end_at)}</p>
              </div>
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Signals</p>
                <p className="mt-2 text-sm">
                  {runSummary?.totalNodeFrequency ?? 0} node hits • {runSummary?.totalEdgeCount ?? 0} edge hits
                </p>
              </div>
            </div>

            {run.warnings.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">Run warnings</p>
                <div className="mt-1 space-y-1">
                  {run.warnings.map((warning) => (
                    <p key={warning}>- {warning}</p>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <Workflow className="h-4 w-4" />
                Ranked Findings + Evidence
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="trace-limit" className="text-xs text-muted-foreground">
                  Trace limit
                </Label>
                <Select value={traceLimit} onValueChange={onTraceLimitChange}>
                  <SelectTrigger id="trace-limit" className="h-8 w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Tabs defaultValue="findings" className="mt-4 space-y-4">
              <TabsList className="h-10">
                <TabsTrigger value="findings">Findings</TabsTrigger>
                <TabsTrigger value="evidence">Evidence</TabsTrigger>
                <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
              </TabsList>

              <TabsContent value="findings" className="space-y-4">
                <div className="grid gap-4 xl:grid-cols-3">
                  <Card className="rounded-xl border border-border bg-background p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Top Paths
                    </p>
                    <Table.Root className="mt-3" variant="ghost">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeaderCell>Path</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell className="text-right">Count</Table.ColumnHeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {pathInsights.map((item) => (
                          <Table.Row
                            key={item.id}
                            className={cn("cursor-pointer", selectedInsight?.id === item.id && "bg-accent")}
                            onClick={() => selectInsight(item)}
                          >
                            <Table.RowHeaderCell>
                              <div className="max-w-[260px] truncate">{item.title}</div>
                              <div className="text-[11px] text-muted-foreground">{item.subtitle}</div>
                            </Table.RowHeaderCell>
                            <Table.Cell className="text-right text-xs">
                              {item.count} ({toRoundedPercent(item.share)})
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </Card>

                  <Card className="rounded-xl border border-border bg-background p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Top Edges
                    </p>
                    <Table.Root className="mt-3" variant="ghost">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeaderCell>Edge</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell className="text-right">Count</Table.ColumnHeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {edgeInsights.map((item) => (
                          <Table.Row
                            key={item.id}
                            className={cn("cursor-pointer", selectedInsight?.id === item.id && "bg-accent")}
                            onClick={() => selectInsight(item)}
                          >
                            <Table.RowHeaderCell>
                              <div className="max-w-[220px] truncate">{item.title}</div>
                              <div className="text-[11px] text-muted-foreground">{item.subtitle}</div>
                            </Table.RowHeaderCell>
                            <Table.Cell className="text-right text-xs">
                              {item.count} ({toRoundedPercent(item.share)})
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </Card>

                  <Card className="rounded-xl border border-border bg-background p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Top Events
                    </p>
                    <Table.Root className="mt-3" variant="ghost">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeaderCell>Event</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell className="text-right">Count</Table.ColumnHeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {nodeInsights.map((item) => (
                          <Table.Row
                            key={item.id}
                            className={cn("cursor-pointer", selectedInsight?.id === item.id && "bg-accent")}
                            onClick={() => selectInsight(item)}
                          >
                            <Table.RowHeaderCell>
                              <div className="max-w-[260px] truncate">{item.title}</div>
                              <div className="text-[11px] text-muted-foreground">{item.subtitle}</div>
                            </Table.RowHeaderCell>
                            <Table.Cell className="text-right text-xs">
                              {item.count} ({toRoundedPercent(item.share)})
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="evidence" className="space-y-4">
                {!selectedInsight && (
                  <div className="rounded-xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                    Pick a finding from the Findings tab to load trace evidence.
                  </div>
                )}

                {selectedInsight && (
                  <Card className="rounded-xl border border-border bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          Selected {selectedInsight.kind}
                        </p>
                        <p className="mt-1 font-medium">{selectedInsight.title}</p>
                        <p className="text-xs text-muted-foreground">{selectedInsight.subtitle}</p>
                      </div>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        handle
                        <span className="ml-1 inline-block max-w-[180px] truncate align-bottom">
                          {selectedInsight.handle}
                        </span>
                      </Badge>
                    </div>

                    {evidenceLoading && (
                      <div className="mt-4 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
                        Loading trace evidence...
                      </div>
                    )}

                    {evidenceError && (
                      <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {evidenceError}
                      </div>
                    )}

                    {evidence && !evidenceLoading && (
                      <div className="mt-4 space-y-4">
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="rounded-lg border border-border px-3 py-2 text-xs">
                            Matched traces: <span className="text-foreground">{evidence.matched_count}</span>
                          </div>
                          <div className="rounded-lg border border-border px-3 py-2 text-xs">
                            Selector type: <span className="text-foreground">{evidence.selector_type}</span>
                          </div>
                          <div className="rounded-lg border border-border px-3 py-2 text-xs">
                            Truncated: <span className="text-foreground">{evidence.truncated ? "Yes" : "No"}</span>
                          </div>
                        </div>

                        <Table.Root variant="surface" size="1">
                          <Table.Header>
                            <Table.Row>
                              <Table.ColumnHeaderCell>Object</Table.ColumnHeaderCell>
                              <Table.ColumnHeaderCell>Trace</Table.ColumnHeaderCell>
                              <Table.ColumnHeaderCell>Events</Table.ColumnHeaderCell>
                              <Table.ColumnHeaderCell>Window</Table.ColumnHeaderCell>
                            </Table.Row>
                          </Table.Header>
                          <Table.Body>
                            {evidence.traces.map((trace) => (
                              <Table.Row key={`${trace.object_type}:${trace.object_ref_hash}:${trace.start_at}`}>
                                <Table.RowHeaderCell>
                                  <div>{trace.object_type}</div>
                                  <div className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground">
                                    {trace.object_ref_canonical}
                                  </div>
                                </Table.RowHeaderCell>
                                <Table.Cell className="font-mono text-[11px]">
                                  {trace.trace_id || "—"}
                                </Table.Cell>
                                <Table.Cell className="max-w-[260px]">
                                  <div className="truncate text-xs">{trace.event_types.join(" -> ") || "—"}</div>
                                  <div className="text-[11px] text-muted-foreground">
                                    {trace.event_ids.length} IDs
                                  </div>
                                </Table.Cell>
                                <Table.Cell className="text-xs">
                                  <div>{formatDateTime(trace.start_at)}</div>
                                  <div className="text-muted-foreground">{formatDateTime(trace.end_at)}</div>
                                </Table.Cell>
                              </Table.Row>
                            ))}
                            {evidence.traces.length === 0 && (
                              <Table.Row>
                                <Table.Cell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                                  No traces matched this selector.
                                </Table.Cell>
                              </Table.Row>
                            )}
                          </Table.Body>
                        </Table.Root>
                      </div>
                    )}
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="snapshot" className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <Card className="rounded-xl border border-border bg-background p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Run Metadata
                    </p>
                    <DataList.Root className="mt-3">
                      <DataList.Item align="center">
                        <DataList.Label minWidth="140px">Anchor model</DataList.Label>
                        <DataList.Value>{modelNameByUri[anchorModelUri] || anchorModelUri}</DataList.Value>
                      </DataList.Item>
                      <DataList.Item align="center">
                        <DataList.Label minWidth="140px">Object types</DataList.Label>
                        <DataList.Value>{run.object_types.join(", ") || "—"}</DataList.Value>
                      </DataList.Item>
                      <DataList.Item align="center">
                        <DataList.Label minWidth="140px">Node count</DataList.Label>
                        <DataList.Value>{run.nodes.length}</DataList.Value>
                      </DataList.Item>
                      <DataList.Item align="center">
                        <DataList.Label minWidth="140px">Edge count</DataList.Label>
                        <DataList.Value>{run.edges.length}</DataList.Value>
                      </DataList.Item>
                      <DataList.Item align="center">
                        <DataList.Label minWidth="140px">Path count</DataList.Label>
                        <DataList.Value>{runSummary?.pathCount || 0}</DataList.Value>
                      </DataList.Item>
                    </DataList.Root>
                  </Card>

                  <Card className="rounded-xl border border-border bg-background p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Object Type Weight
                    </p>
                    <div className="mt-3 space-y-2">
                      {objectTypeCounts.map((item) => {
                        const total = runSummary?.totalEdgeCount || 0;
                        const width = total > 0 ? (item.count / total) * 100 : 0;
                        return (
                          <div key={item.objectType}>
                            <div className="flex items-center justify-between text-xs">
                              <span>{item.objectType}</span>
                              <span>{item.count}</span>
                            </div>
                            <div className="mt-1 h-2 rounded-full bg-muted">
                              <div
                                className="h-2 rounded-full bg-primary/70"
                                style={{ width: `${Math.max(4, width)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {objectTypeCounts.length === 0 && (
                        <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                          No object type counts available in this run.
                        </div>
                      )}
                    </div>
                  </Card>
                </div>

                <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Clock3 className="h-3.5 w-3.5" />
                    Recommended next actions
                  </div>
                  <div className="mt-2 space-y-1">
                    <p>1. Inspect top path evidence and verify whether it matches intended process behavior.</p>
                    <p>2. Review highest-volume edge transitions for possible bottlenecks or rework loops.</p>
                    <p>3. Compare dominant object type weight against expected operational mix.</p>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </Card>
        </>
      )}

      {!run && runState === "idle" && (
        <Card className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          <Link2 className="mx-auto mb-3 h-5 w-5" />
          Run the insights flow to generate ranked findings and trace-backed evidence.
        </Card>
      )}
    </div>
  );
}
