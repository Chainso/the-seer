"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, Filter, Layers } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SearchableSelect } from "../ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

import type { OntologyRuntimeOverlay } from "@/app/types/analytics";
import type { OntologyGraph, OntologyNode } from "@/app/types/ontology";
import { getOntologyRuntimeOverlay } from "@/app/lib/api/analytics";
import { getOntologyGraph } from "@/app/lib/api/ontology";
import { OntologyAnalyticsGraph } from "./ontology-analytics-graph";

interface FilterPair {
  id: string;
  key: string;
  value: string;
}

interface KpiLineageRef {
  uri: string;
  label: string;
  relation: string;
}

interface BoundKpi {
  id: string;
  title: string;
  value: string;
  subtitle: string;
  lineage: KpiLineageRef[];
}

interface OpportunityRecommendation {
  id: string;
  title: string;
  rationale: string;
  expectedImpact: string;
  score: number;
  confidence: number;
  assumptions: string[];
  primaryConceptUri?: string;
}

interface ScenarioRun {
  id: string;
  createdAt: string;
  opportunityId: string;
  opportunityTitle: string;
  changePercent: number;
  adoptionPercent: number;
  assumptions: string[];
  projectedThroughputDelta: number;
  projectedTailP95DeltaSeconds: number;
  projectedConformanceDeltaPct: number;
}

export function OntologyAnalyticsPanel() {
  const [graph, setGraph] = useState<OntologyGraph | null>(null);
  const [models, setModels] = useState<OntologyNode[]>([]);
  const [modelUri, setModelUri] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [edgeMetricMode, setEdgeMetricMode] = useState<"share" | "count">("share");
  const [stateDurationMetric, setStateDurationMetric] = useState<"avgSeconds" | "p50Seconds" | "p95Seconds">("p95Seconds");
  const [filters, setFilters] = useState<FilterPair[]>([{ id: "filter-0", key: "", value: "" }]);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState("");
  const [changePercent, setChangePercent] = useState("20");
  const [adoptionPercent, setAdoptionPercent] = useState("60");
  const [scenarioRuns, setScenarioRuns] = useState<ScenarioRun[]>([]);

  const [overlay, setOverlay] = useState<OntologyRuntimeOverlay | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getOntologyGraph()
      .then(data => {
        if (!active) return;
        setGraph(data);
        const modelNodes = data.nodes.filter(node => node.label === "ObjectModel");
        setModels(modelNodes);
        if (!modelUri && modelNodes.length > 0) {
          setModelUri(modelNodes[0].uri);
        }
      })
      .catch(() => {
        if (!active) return;
        setGraph(null);
      });
    return () => {
      active = false;
    };
  }, [modelUri]);

  const modelOptions = useMemo(() => {
    return models.map(node => ({
      uri: node.uri,
      name: (node.properties?.name as string) || node.uri,
    }));
  }, [models]);

  const nodeNameByUri = useMemo(() => {
    const lookup = new Map<string, string>();
    (graph?.nodes || []).forEach(node => {
      lookup.set(node.uri, (node.properties?.name as string) || node.uri);
    });
    return lookup;
  }, [graph]);

  const resolvedFrom = from ? new Date(from).toISOString() : undefined;
  const resolvedTo = to ? new Date(to).toISOString() : undefined;

  const filterMap = useMemo(() => {
    const active = filters.filter(item => item.key.trim() && item.value.trim());
    if (active.length === 0) return undefined;
    return active.reduce<Record<string, string>>((acc, item) => {
      acc[item.key.trim()] = item.value.trim();
      return acc;
    }, {});
  }, [filters]);

  const divergence = useMemo(() => {
    if (!graph || !modelUri || !overlay) {
      return null;
    }

    const transitionUris = graph.edges
      .filter(edge => edge.type === "transitionOf" && edge.toUri === modelUri)
      .map(edge => edge.fromUri);

    const intendedPairs = transitionUris
      .map((transitionUri) => {
        const fromState = graph.edges.find(
          edge => edge.type === "fromState" && edge.fromUri === transitionUri
        )?.toUri;
        const toState = graph.edges.find(
          edge => edge.type === "toState" && edge.fromUri === transitionUri
        )?.toUri;
        if (!fromState || !toState) {
          return null;
        }
        const key = `${fromState}::${toState}`;
        return {
          key,
          fromState,
          toState,
          fromName: nodeNameByUri.get(fromState) || fromState,
          toName: nodeNameByUri.get(toState) || toState,
        };
      })
      .filter((pair): pair is NonNullable<typeof pair> => pair !== null);

    const intendedKeys = new Set(intendedPairs.map(pair => pair.key));
    const observedPairs = overlay.flows
      .map(flow => ({
        ...flow,
        key: `${flow.fromState}::${flow.toState}`,
      }))
      .sort((a, b) => b.count - a.count);
    const observedKeys = new Set(observedPairs.map(pair => pair.key));

    const missingIntended = intendedPairs.filter(pair => !observedKeys.has(pair.key));
    const unexpectedObserved = observedPairs
      .filter(pair => !intendedKeys.has(pair.key))
      .map(pair => ({
        ...pair,
        fromName: nodeNameByUri.get(pair.fromState) || pair.fromState,
        toName: nodeNameByUri.get(pair.toState) || pair.toState,
      }));

    const denominator = Math.max(1, intendedPairs.length);
    const divergenceScore = Math.min(1, (missingIntended.length + unexpectedObserved.length) / denominator);

    return {
      divergenceScore,
      intendedCount: intendedPairs.length,
      observedCount: observedPairs.length,
      missingIntended,
      unexpectedObserved,
    };
  }, [graph, modelUri, nodeNameByUri, overlay]);

  const boundKpis = useMemo<BoundKpi[]>(() => {
    if (!overlay) {
      return [];
    }
    const topFlow = [...overlay.flows].sort((a, b) => b.count - a.count)[0];
    const topDuration = [...overlay.stateDurations]
      .sort((a, b) => (b[stateDurationMetric] || 0) - (a[stateDurationMetric] || 0))[0];
    const conformance = divergence ? Math.max(0, 1 - divergence.divergenceScore) : null;

    const throughputKpi: BoundKpi = {
      id: "transition-throughput",
      title: "Transition Throughput",
      value: `${overlay.stats.totalFlowCount}`,
      subtitle: "Total observed transition events in selected window",
      lineage: topFlow
        ? [
            {
              uri: topFlow.fromState,
              label: nodeNameByUri.get(topFlow.fromState) || topFlow.fromState,
              relation: "from-state",
            },
            {
              uri: topFlow.toState,
              label: nodeNameByUri.get(topFlow.toState) || topFlow.toState,
              relation: "to-state",
            },
          ]
        : [],
    };

    const tailDurationValue = topDuration ? topDuration[stateDurationMetric] : undefined;
    const tailDurationKpi: BoundKpi = {
      id: "state-tail-duration",
      title: "State Tail Duration",
      value: tailDurationValue ? `${tailDurationValue.toFixed(1)}s` : "—",
      subtitle: `Highest ${stateDurationMetric.replace("Seconds", "")} state duration`,
      lineage: topDuration
        ? [
            {
              uri: topDuration.stateUri,
              label: nodeNameByUri.get(topDuration.stateUri) || topDuration.stateUri,
              relation: "state",
            },
          ]
        : [],
    };

    const conformanceKpi: BoundKpi = {
      id: "model-conformance",
      title: "Model Conformance",
      value: conformance === null ? "—" : `${(conformance * 100).toFixed(1)}%`,
      subtitle: "Alignment of observed transition pairs with intended ontology paths",
      lineage:
        divergence?.missingIntended.slice(0, 2).flatMap(pair => [
          { uri: pair.fromState, label: pair.fromName, relation: "missing-from" },
          { uri: pair.toState, label: pair.toName, relation: "missing-to" },
        ]) || [],
    };

    return [throughputKpi, tailDurationKpi, conformanceKpi];
  }, [divergence, nodeNameByUri, overlay, stateDurationMetric]);

  const opportunities = useMemo<OpportunityRecommendation[]>(() => {
    if (!overlay) {
      return [];
    }

    const ranked: OpportunityRecommendation[] = [];
    const topDuration = [...overlay.stateDurations].sort((a, b) => b.p95Seconds - a.p95Seconds)[0];
    if (topDuration && topDuration.p95Seconds > 0) {
      const stateName = nodeNameByUri.get(topDuration.stateUri) || topDuration.stateUri;
      const durationScore = Math.min(100, Math.round(topDuration.p95Seconds / 6));
      ranked.push({
        id: `duration-${topDuration.stateUri}`,
        title: `Reduce tail dwell in ${stateName}`,
        rationale: `P95 dwell is ${topDuration.p95Seconds.toFixed(1)}s with ${topDuration.count} samples.`,
        expectedImpact: "Lower cycle-time variance and faster SLA recovery.",
        score: durationScore,
        confidence: Math.min(0.95, 0.45 + Math.min(topDuration.count, 500) / 1000),
        assumptions: [
          "Duration samples are representative for the selected time window.",
          "Bottleneck is local to this state and not downstream saturation.",
        ],
        primaryConceptUri: topDuration.stateUri,
      });
    }

    const topUnexpected = divergence?.unexpectedObserved[0];
    if (topUnexpected) {
      ranked.push({
        id: `unexpected-${topUnexpected.key}`,
        title: `Investigate unexpected path ${topUnexpected.fromName} → ${topUnexpected.toName}`,
        rationale: `${topUnexpected.count} events observed on a path not present in intended ontology transitions.`,
        expectedImpact: "Improve process conformance and reduce hidden rework loops.",
        score: Math.min(100, 55 + Math.round(topUnexpected.count / 10)),
        confidence: Math.min(0.9, 0.4 + Math.min(topUnexpected.count, 400) / 900),
        assumptions: [
          "Observed path is not due to temporary rollout skew.",
          "Instrumentation correctly captures from/to states.",
        ],
        primaryConceptUri: topUnexpected.fromState,
      });
    }

    const missingIntended = divergence?.missingIntended[0];
    if (missingIntended) {
      ranked.push({
        id: `missing-${missingIntended.key}`,
        title: `Recover intended transition ${missingIntended.fromName} → ${missingIntended.toName}`,
        rationale: "Intended ontology path has no observed traffic in selected window.",
        expectedImpact: "Increase intended-path utilization and reduce manual bypasses.",
        score: 60,
        confidence: 0.55,
        assumptions: [
          "Transition should be active for this business segment/time window.",
          "No intentional feature flag currently suppresses this path.",
        ],
        primaryConceptUri: missingIntended.fromState,
      });
    }

    const topFlow = [...overlay.flows].sort((a, b) => b.count - a.count)[0];
    if (topFlow) {
      const fromName = nodeNameByUri.get(topFlow.fromState) || topFlow.fromState;
      const toName = nodeNameByUri.get(topFlow.toState) || topFlow.toState;
      ranked.push({
        id: `throughput-${topFlow.fromState}-${topFlow.toState}`,
        title: `Optimize highest-volume path ${fromName} → ${toName}`,
        rationale: `${topFlow.count} events and ${(topFlow.share * 100).toFixed(1)}% traffic share.`,
        expectedImpact: "Largest immediate throughput improvement per engineering hour.",
        score: Math.min(100, 50 + Math.round(topFlow.share * 60)),
        confidence: Math.min(0.9, 0.5 + topFlow.share / 2),
        assumptions: [
          "Path volume concentration is stable over adjacent windows.",
          "Latency/cost improvements on this path are feasible.",
        ],
        primaryConceptUri: topFlow.fromState,
      });
    }

    return ranked.sort((a, b) => b.score - a.score).slice(0, 5);
  }, [divergence, nodeNameByUri, overlay]);

  const effectiveOpportunityId = selectedOpportunityId || opportunities[0]?.id || "";
  const selectedOpportunity = opportunities.find(opportunity => opportunity.id === effectiveOpportunityId) || null;

  const simulationPreview = useMemo(() => {
    if (!overlay || !selectedOpportunity) {
      return null;
    }
    const normalizedChange = Math.max(0, Number(changePercent) || 0) / 100;
    const normalizedAdoption = Math.max(0, Number(adoptionPercent) || 0) / 100;
    const baseImpactFactor =
      normalizedChange * normalizedAdoption * (selectedOpportunity.score / 100) * selectedOpportunity.confidence;

    const topTailDuration = Math.max(0, ...overlay.stateDurations.map(metric => metric.p95Seconds));
    const divergenceScore = divergence?.divergenceScore || 0;

    const projectedThroughputDelta = Math.round(overlay.stats.totalFlowCount * baseImpactFactor * 0.25);
    const projectedTailP95DeltaSeconds = Number((topTailDuration * baseImpactFactor * 0.35).toFixed(1));
    const projectedConformanceDeltaPct = Number((divergenceScore * baseImpactFactor * 100 * 0.6).toFixed(1));

    return {
      projectedThroughputDelta,
      projectedTailP95DeltaSeconds,
      projectedConformanceDeltaPct,
      assumptions: [
        ...selectedOpportunity.assumptions,
        `Change factor: ${Number(changePercent) || 0}%`,
        `Adoption factor: ${Number(adoptionPercent) || 0}%`,
      ],
    };
  }, [adoptionPercent, changePercent, divergence, overlay, selectedOpportunity]);

  const loadAnalytics = async () => {
    if (!modelUri) return;
    setLoading(true);
    setError(null);
    try {
      const nextOverlay = await getOntologyRuntimeOverlay({
        modelUri,
        from: resolvedFrom,
        to: resolvedTo,
        filters: filterMap,
      });
      setOverlay(nextOverlay);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  };

  const updateFilter = (id: string, updates: Partial<FilterPair>) => {
    setFilters(prev => prev.map(item => (item.id === id ? { ...item, ...updates } : item)));
  };

  const addFilter = () => {
    setFilters(prev => [...prev, { id: `filter-${prev.length + 1}`, key: "", value: "" }]);
  };

  const removeFilter = (id: string) => {
    setFilters(prev => prev.filter(item => item.id !== id));
  };

  const runScenario = () => {
    if (!selectedOpportunity || !simulationPreview) {
      return;
    }
    const run: ScenarioRun = {
      id: `scenario-${Date.now()}`,
      createdAt: new Date().toISOString(),
      opportunityId: selectedOpportunity.id,
      opportunityTitle: selectedOpportunity.title,
      changePercent: Number(changePercent) || 0,
      adoptionPercent: Number(adoptionPercent) || 0,
      assumptions: simulationPreview.assumptions,
      projectedThroughputDelta: simulationPreview.projectedThroughputDelta,
      projectedTailP95DeltaSeconds: simulationPreview.projectedTailP95DeltaSeconds,
      projectedConformanceDeltaPct: simulationPreview.projectedConformanceDeltaPct,
    };
    setScenarioRuns((prev) => [run, ...prev].slice(0, 8));
  };

  useEffect(() => {
    setOverlay(null);
  }, [modelUri]);

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <Filter className="h-4 w-4" />
            Analytics Filters
          </div>
          <Badge className="gap-2 rounded-full bg-muted px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em]">
            <BarChart3 className="h-3 w-3" />
            Flow + Duration {overlay ? `(${overlay.stats.totalFlowCount} activities)` : ""}
          </Badge>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr_0.6fr]">
          <div className="space-y-2">
            <Label htmlFor="model">Object model</Label>
            <SearchableSelect
              triggerId="model"
              value={modelUri}
              onValueChange={value => setModelUri(value)}
              groups={[
                {
                  label: "Object models",
                  options: modelOptions.map(option => ({ value: option.uri, label: option.name })),
                },
              ]}
              placeholder="Select model"
              searchPlaceholder="Search models..."
              emptyMessage="No models found."
            />
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
            <Button className="w-full" onClick={loadAnalytics} disabled={!modelUri || loading}>
              {loading ? "Loading..." : "Run analysis"}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="edge-metric">Edge emphasis</Label>
            <Select value={edgeMetricMode} onValueChange={value => setEdgeMetricMode(value as typeof edgeMetricMode)}>
              <SelectTrigger id="edge-metric">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="share">Share (%)</SelectItem>
                <SelectItem value="count">Volume (count)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="duration-metric">State duration emphasis</Label>
            <Select
              value={stateDurationMetric}
              onValueChange={value => setStateDurationMetric(value as typeof stateDurationMetric)}
            >
              <SelectTrigger id="duration-metric">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="avgSeconds">Average</SelectItem>
                <SelectItem value="p50Seconds">P50</SelectItem>
                <SelectItem value="p95Seconds">P95</SelectItem>
              </SelectContent>
            </Select>
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

      {overlay && (
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              KPI Bindings
            </div>
            <Badge variant="outline">{boundKpis.length} mapped</Badge>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {boundKpis.map((kpi) => (
              <div key={kpi.id} className="rounded-xl border border-border bg-background p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{kpi.title}</p>
                <p className="mt-2 font-display text-2xl">{kpi.value}</p>
                <p className="mt-2 text-xs text-muted-foreground">{kpi.subtitle}</p>
                <div className="mt-3 space-y-2">
                  {kpi.lineage.slice(0, 4).map((entry) => (
                    <Link
                      key={`${kpi.id}-${entry.relation}-${entry.uri}`}
                      href={`/ontology/overview?conceptUri=${encodeURIComponent(entry.uri)}`}
                      className="flex items-center justify-between rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent"
                    >
                      <span className="truncate">{entry.label}</span>
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {entry.relation}
                      </Badge>
                    </Link>
                  ))}
                  {kpi.lineage.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
                      No lineage refs in current window.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {overlay && (
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Opportunity Ranking
            </div>
            <Badge variant="outline">{opportunities.length} ranked</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {opportunities.map((opportunity, index) => (
              <div key={opportunity.id} className="rounded-xl border border-border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-display text-base">
                    {index + 1}. {opportunity.title}
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">score {opportunity.score}</Badge>
                    <Badge variant="outline">confidence {(opportunity.confidence * 100).toFixed(0)}%</Badge>
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{opportunity.rationale}</p>
                <p className="mt-1 text-xs text-muted-foreground">{opportunity.expectedImpact}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {opportunity.assumptions.map((assumption, assumptionIndex) => (
                    <span
                      key={`${opportunity.id}-assumption-${assumptionIndex}`}
                      className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground"
                    >
                      {assumption}
                    </span>
                  ))}
                </div>
                {opportunity.primaryConceptUri && (
                  <div className="mt-3">
                    <Link
                      href={`/ontology/overview?conceptUri=${encodeURIComponent(opportunity.primaryConceptUri)}`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Open primary ontology concept
                    </Link>
                  </div>
                )}
              </div>
            ))}
            {opportunities.length === 0 && (
              <div className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                Run analysis to generate ranked optimization opportunities.
              </div>
            )}
          </div>
        </Card>
      )}

      {overlay && (
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Scenario Simulator
            </div>
            <Badge variant="outline">v1 shell</Badge>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-4">
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="scenario-opportunity">Opportunity</Label>
              <SearchableSelect
                triggerId="scenario-opportunity"
                value={effectiveOpportunityId}
                onValueChange={value => setSelectedOpportunityId(value)}
                groups={[
                  {
                    label: "Opportunities",
                    options: opportunities.map(opportunity => ({
                      value: opportunity.id,
                      label: opportunity.title,
                      description: `score ${opportunity.score}`,
                    })),
                  },
                ]}
                placeholder="Select opportunity"
                searchPlaceholder="Search opportunities..."
                emptyMessage="No opportunities found."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scenario-change">Change (%)</Label>
              <Input
                id="scenario-change"
                type="number"
                value={changePercent}
                onChange={e => setChangePercent(e.target.value)}
                min={0}
                max={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scenario-adoption">Adoption (%)</Label>
              <Input
                id="scenario-adoption"
                type="number"
                value={adoptionPercent}
                onChange={e => setAdoptionPercent(e.target.value)}
                min={0}
                max={100}
              />
            </div>
          </div>
          {simulationPreview && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                Throughput delta: <span className="text-foreground">+{simulationPreview.projectedThroughputDelta} events</span>
              </div>
              <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                Tail p95 delta: <span className="text-foreground">-{simulationPreview.projectedTailP95DeltaSeconds}s</span>
              </div>
              <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                Conformance delta: <span className="text-foreground">+{simulationPreview.projectedConformanceDeltaPct}%</span>
              </div>
            </div>
          )}
          <div className="mt-4">
            <Button variant="outline" onClick={runScenario} disabled={!simulationPreview}>
              Run scenario
            </Button>
          </div>
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Saved Runs</p>
            {scenarioRuns.map((run) => (
              <div key={run.id} className="rounded-xl border border-border bg-background px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{run.opportunityTitle}</span>
                  <span className="text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  change {run.changePercent}% • adoption {run.adoptionPercent}% • +{run.projectedThroughputDelta} events •
                  -{run.projectedTailP95DeltaSeconds}s p95 • +{run.projectedConformanceDeltaPct}% conformance
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {run.assumptions.map((assumption, assumptionIndex) => (
                    <span
                      key={`${run.id}-assumption-${assumptionIndex}`}
                      className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground"
                    >
                      {assumption}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {scenarioRuns.length === 0 && (
              <div className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                Run a scenario to create a reproducible snapshot with assumptions.
              </div>
            )}
          </div>
        </Card>
      )}

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Layers className="h-4 w-4" />
          Analytics Graph
        </div>
        <div className="mt-5">
          {graph && modelUri ? (
            <OntologyAnalyticsGraph
              graph={graph}
              modelUri={modelUri}
              flows={overlay?.flows || []}
              durations={overlay?.stateDurations || []}
              edgeMetricMode={edgeMetricMode}
              stateDurationMetric={stateDurationMetric}
            />
          ) : (
            <div className="flex h-[640px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
              Select a model to render the analytics graph.
            </div>
          )}
        </div>
        {overlay && (
          <div className="mt-4 rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-[0.2em]">Overlay Snapshot</span>{" "}
            {overlay.stats.transitionPairCount} transition pairs • {overlay.stats.stateDurationCount} state duration series • generated{" "}
            {new Date(overlay.generatedAt).toLocaleTimeString()}
          </div>
        )}
        {divergence && (
          <div className="mt-4 rounded-2xl border border-border bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Model vs Reality</p>
                <h3 className="font-display text-lg">Divergence</h3>
              </div>
              <Badge variant="secondary">
                {(divergence.divergenceScore * 100).toFixed(0)}% divergence
              </Badge>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-border px-3 py-2">
                Intended transitions: <span className="text-foreground">{divergence.intendedCount}</span>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                Observed transition pairs: <span className="text-foreground">{divergence.observedCount}</span>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                Missing intended: <span className="text-foreground">{divergence.missingIntended.length}</span>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                Unexpected observed: <span className="text-foreground">{divergence.unexpectedObserved.length}</span>
              </div>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Missing Intended Paths</p>
                <div className="mt-2 space-y-2">
                  {divergence.missingIntended.slice(0, 5).map(pair => (
                    <div key={pair.key} className="rounded-lg border border-border px-3 py-2 text-xs">
                      {pair.fromName} → {pair.toName}
                    </div>
                  ))}
                  {divergence.missingIntended.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                      No missing intended transitions in this window.
                    </div>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Unexpected Observed Paths</p>
                <div className="mt-2 space-y-2">
                  {divergence.unexpectedObserved.slice(0, 5).map(pair => (
                    <div key={pair.key} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
                      <span>{pair.fromName} → {pair.toName}</span>
                      <Badge variant="outline">{pair.count}</Badge>
                    </div>
                  ))}
                  {divergence.unexpectedObserved.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                      No unexpected transition pairs detected.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-6 rounded-full bg-foreground/20" />
            Edge thickness = {edgeMetricMode === "share" ? "share" : "count"} emphasis
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-border bg-[color:var(--graph-node-state-bg)] text-[0.6rem] font-semibold">
              S
            </span>
            State nodes show avg/p50/p95 with active {stateDurationMetric.replace("Seconds", "")}
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em]">
              count • share
            </span>
            Edge labels
          </div>
        </div>
      </Card>
    </div>
  );
}
