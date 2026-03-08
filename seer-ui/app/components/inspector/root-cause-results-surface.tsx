"use client";

import { useMemo, useRef } from "react";
import { DataList } from "@radix-ui/themes";
import { Bot, FlaskConical } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Table } from "../ui/table";

import { cn } from "@/app/lib/utils";
import type {
  RootCauseAssistInterpretResponseContract,
  RootCauseEvidenceResponseContract,
  RootCauseInsightResultContract,
  RootCauseRunResponseContract,
} from "@/app/types/root-cause";

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

function toPercent(value: number): string {
  return `${(Math.max(0, value) * 100).toFixed(2)}%`;
}

function stringifyRefValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseTraceAnchor(trace: RootCauseEvidenceResponseContract["traces"][number]): {
  objectType: string;
  keyParts: Record<string, string>;
  fallbackRef: string;
} {
  const anchorKey = trace.anchor_key || "";
  const firstSep = anchorKey.indexOf("|");
  const secondSep = firstSep >= 0 ? anchorKey.indexOf("|", firstSep + 1) : -1;

  const objectTypeFromKey = firstSep > 0 ? anchorKey.slice(0, firstSep) : "";
  const canonicalFromKey = secondSep > firstSep ? anchorKey.slice(secondSep + 1) : "";
  const canonicalRaw = (trace.anchor_object_ref_canonical || canonicalFromKey || "").trim();

  const objectType = objectTypeFromKey || trace.anchor_object_type || "—";
  if (!canonicalRaw) {
    const fallback = trace.anchor_object_ref_hash ? String(trace.anchor_object_ref_hash) : "—";
    return {
      objectType,
      keyParts: {},
      fallbackRef: fallback,
    };
  }

  try {
    const parsed = JSON.parse(canonicalRaw) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return {
        objectType,
        keyParts: {},
        fallbackRef: stringifyRefValue(parsed),
      };
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0) {
      return {
        objectType,
        keyParts: {},
        fallbackRef: "—",
      };
    }
    const keyParts = entries.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = stringifyRefValue(value) || "—";
      return acc;
    }, {});
    return { objectType, keyParts, fallbackRef: canonicalRaw };
  } catch {
    return {
      objectType,
      keyParts: {},
      fallbackRef: canonicalRaw,
    };
  }
}

function summarizeTraceEvents(
  events: RootCauseEvidenceResponseContract["traces"][number]["events"],
  displayEventType: (eventType: string) => string
): string {
  if (events.length === 0) {
    return "—";
  }
  return events
    .slice(0, 5)
    .map((event) => displayEventType(event.event_type))
    .join(" -> ");
}

export interface RootCauseResultsSurfaceProps {
  run: RootCauseRunResponseContract;
  selectedInsightId: string | null;
  onSelectInsight: (insight: RootCauseInsightResultContract) => void;
  evidenceLimit: string;
  onEvidenceLimitChange: (value: string) => void;
  evidence: RootCauseEvidenceResponseContract | null;
  evidenceLoading: boolean;
  evidenceError: string | null;
  interpretation: RootCauseAssistInterpretResponseContract | null;
  interpretLoading: boolean;
  interpretError: string | null;
  onRunInterpretation: () => void;
  displayObjectType: (objectType: string) => string;
  displayFilterFieldLabel: (fieldKey: string) => string;
  displayEventType: (eventType: string) => string;
}

export function RootCauseResultsSurface({
  run,
  selectedInsightId,
  onSelectInsight,
  evidenceLimit,
  onEvidenceLimitChange,
  evidence,
  evidenceLoading,
  evidenceError,
  interpretation,
  interpretLoading,
  interpretError,
  onRunInterpretation,
  displayObjectType,
  displayFilterFieldLabel,
  displayEventType,
}: RootCauseResultsSurfaceProps) {
  const rankedInsightsRef = useRef<HTMLDivElement | null>(null);
  const evidenceSectionRef = useRef<HTMLDivElement | null>(null);

  const selectedInsight = useMemo(() => {
    if (!selectedInsightId) {
      return run.insights[0] || null;
    }
    return run.insights.find((insight) => insight.insight_id === selectedInsightId) || run.insights[0] || null;
  }, [run.insights, selectedInsightId]);
  const evidenceTraceRows = useMemo(
    () => (evidence?.traces || []).map((trace) => ({ trace, anchor: parseTraceAnchor(trace) })),
    [evidence]
  );
  const evidenceAnchorColumns = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    evidenceTraceRows.forEach(({ anchor }) => {
      Object.keys(anchor.keyParts).forEach((key) => {
        if (!seen.has(key)) {
          seen.add(key);
          ordered.push(key);
        }
      });
    });
    return ordered;
  }, [evidenceTraceRows]);

  return (
    <div className="space-y-6" data-root-cause-results-surface>
      <Card className="rounded-2xl border border-primary/25 bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Results Ready</p>
            <h2 className="mt-2 font-display text-2xl">Root-cause run completed</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Review ranked hypotheses first, then open evidence traces to inspect concrete supporting examples.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => rankedInsightsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              Jump to Ranked Insights
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => evidenceSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              Jump to Evidence
            </Button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Hypotheses</p>
            <p className="mt-2 text-sm font-medium">{run.insights.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Cohort size</p>
            <p className="mt-2 text-sm font-medium">{run.cohort_size}</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Positives</p>
            <p className="mt-2 text-sm font-medium">{run.positive_count}</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Warnings</p>
            <p className="mt-2 text-sm font-medium">{run.warnings.length}</p>
          </div>
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Anchor</p>
            <p className="mt-2 text-sm font-medium">{displayObjectType(run.anchor_object_type)}</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Cohort</p>
            <p className="mt-2 text-sm font-medium">{run.cohort_size}</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Positives</p>
            <p className="mt-2 text-sm font-medium">{run.positive_count}</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Baseline rate</p>
            <p className="mt-2 text-sm font-medium">{toPercent(run.baseline_rate)}</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Feature count</p>
            <p className="mt-2 text-sm font-medium">{run.feature_count}</p>
          </div>
        </div>
        {run.warnings.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {run.warnings.map((warning, index) => (
              <p key={`${warning}-${index}`}>- {warning}</p>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
        <div ref={rankedInsightsRef}>
          <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Ranked Insights
              </div>
              <Badge variant="outline">{run.insights.length} hypotheses</Badge>
            </div>
            <Table.Root className="mt-4" variant="surface" striped>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Hypothesis</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="text-right">WRAcc</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="text-right">Lift</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="text-right">Coverage</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="text-right">Support</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {run.insights.map((insight) => (
                  <Table.Row
                    key={insight.insight_id}
                    className={cn("cursor-pointer", selectedInsight?.insight_id === insight.insight_id && "bg-accent")}
                    onClick={() => onSelectInsight(insight)}
                  >
                    <Table.RowHeaderCell>
                      <div className="max-w-[360px] truncate">
                        {insight.rank}. {insight.title}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        positives {insight.score.positives} / support {insight.score.support}
                      </div>
                    </Table.RowHeaderCell>
                    <Table.Cell className="text-right text-xs">{insight.score.wracc.toFixed(4)}</Table.Cell>
                    <Table.Cell className="text-right text-xs">{insight.score.lift.toFixed(2)}</Table.Cell>
                    <Table.Cell className="text-right text-xs">{toPercent(insight.score.coverage)}</Table.Cell>
                    <Table.Cell className="text-right text-xs">{insight.score.support}</Table.Cell>
                  </Table.Row>
                ))}
                {run.insights.length === 0 && (
                  <Table.Row>
                    <Table.Cell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      No ranked hypotheses for this run.
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Root>
          </Card>
        </div>

        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Selected Insight
          </div>
          {!selectedInsight && (
            <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              Select an insight to inspect details and evidence.
            </div>
          )}
          {selectedInsight && (
            <div className="mt-4 space-y-4">
              <div>
                <p className="font-medium">{selectedInsight.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{selectedInsight.caveat}</p>
              </div>
              <DataList.Root>
                <DataList.Item>
                  <DataList.Label minWidth="132px">WRAcc</DataList.Label>
                  <DataList.Value>{selectedInsight.score.wracc.toFixed(4)}</DataList.Value>
                </DataList.Item>
                <DataList.Item>
                  <DataList.Label minWidth="132px">Lift</DataList.Label>
                  <DataList.Value>{selectedInsight.score.lift.toFixed(2)}</DataList.Value>
                </DataList.Item>
                <DataList.Item>
                  <DataList.Label minWidth="132px">Coverage</DataList.Label>
                  <DataList.Value>{toPercent(selectedInsight.score.coverage)}</DataList.Value>
                </DataList.Item>
                <DataList.Item>
                  <DataList.Label minWidth="132px">Subgroup rate</DataList.Label>
                  <DataList.Value>{toPercent(selectedInsight.score.subgroup_rate)}</DataList.Value>
                </DataList.Item>
              </DataList.Root>
            </div>
          )}
        </Card>
      </div>

      <div ref={evidenceSectionRef}>
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Evidence Traces
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="evidence-limit" className="text-xs text-muted-foreground">
                Trace limit
              </Label>
              <Select value={evidenceLimit} onValueChange={onEvidenceLimitChange}>
                <SelectTrigger id="evidence-limit" className="h-8 w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {evidenceLoading && (
            <div className="mt-4 rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
              Loading evidence traces...
            </div>
          )}
          {evidenceError && (
            <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {evidenceError}
            </div>
          )}
          {evidence && !evidenceLoading && (
            <div className="mt-4">
              <div className="mb-3 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border px-3 py-2 text-xs">
                  Matched anchors: <span className="text-foreground">{evidence.matched_anchor_count}</span>
                </div>
                <div className="rounded-lg border border-border px-3 py-2 text-xs">
                  Matched positives: <span className="text-foreground">{evidence.matched_positive_count}</span>
                </div>
                <div className="rounded-lg border border-border px-3 py-2 text-xs">
                  Truncated: <span className="text-foreground">{evidence.truncated ? "Yes" : "No"}</span>
                </div>
              </div>
              <Table.Root variant="surface" size="1">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Object Type</Table.ColumnHeaderCell>
                    {evidenceAnchorColumns.length > 0 ? (
                      evidenceAnchorColumns.map((key) => (
                        <Table.ColumnHeaderCell key={`anchor-col-${key}`}>
                          {displayFilterFieldLabel(key)}
                        </Table.ColumnHeaderCell>
                      ))
                    ) : (
                      <Table.ColumnHeaderCell>Reference</Table.ColumnHeaderCell>
                    )}
                    <Table.ColumnHeaderCell>Outcome</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Events</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Window</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {evidenceTraceRows.map(({ trace, anchor }) => (
                    <Table.Row key={`${trace.anchor_key}:${trace.anchor_object_ref_hash}`}>
                      <Table.RowHeaderCell>
                        <div>{displayObjectType(anchor.objectType)}</div>
                      </Table.RowHeaderCell>
                      {evidenceAnchorColumns.length > 0 ? (
                        evidenceAnchorColumns.map((key) => (
                          <Table.Cell key={`${trace.anchor_key}:${key}`} className="max-w-[220px]">
                            <div className="truncate text-xs font-medium">{anchor.keyParts[key] || "—"}</div>
                          </Table.Cell>
                        ))
                      ) : (
                        <Table.Cell className="max-w-[260px]">
                          <div className="truncate text-xs font-medium">{anchor.fallbackRef || "—"}</div>
                        </Table.Cell>
                      )}
                      <Table.Cell>
                        <Badge variant={trace.outcome ? "default" : "secondary"}>
                          {trace.outcome ? "Positive" : "Negative"}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell className="max-w-[380px]">
                        <div className="truncate text-xs">{summarizeTraceEvents(trace.events, displayEventType)}</div>
                        <div className="text-[11px] text-muted-foreground">{trace.events.length} events</div>
                      </Table.Cell>
                      <Table.Cell className="text-xs">
                        <div>{formatDateTime(trace.events[0]?.occurred_at)}</div>
                        <div className="text-muted-foreground">
                          {formatDateTime(trace.events[trace.events.length - 1]?.occurred_at)}
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                  {evidence.traces.length === 0 && (
                    <Table.Row>
                      <Table.Cell
                        colSpan={4 + (evidenceAnchorColumns.length > 0 ? evidenceAnchorColumns.length : 1)}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        No evidence traces for this insight.
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table.Root>
            </div>
          )}
        </Card>
      </div>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <Bot className="h-4 w-4" />
            AI Interpretation
          </div>
          <Button variant="outline" onClick={onRunInterpretation} disabled={interpretLoading || run.insights.length === 0}>
            <FlaskConical className="mr-2 h-4 w-4" />
            {interpretLoading ? "Interpreting..." : "Interpret run"}
          </Button>
        </div>
        {interpretError && (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {interpretError}
          </div>
        )}
        {interpretation && (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-border bg-background px-4 py-3 text-sm">
              {interpretation.summary}
            </div>
            {interpretation.caveats.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                <p className="mb-1 font-semibold uppercase tracking-[0.2em]">Caveats</p>
                {interpretation.caveats.map((caveat, index) => (
                  <p key={`${caveat}-${index}`}>- {caveat}</p>
                ))}
              </div>
            )}
            {interpretation.next_steps.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                <p className="mb-1 font-semibold uppercase tracking-[0.2em]">Next steps</p>
                {interpretation.next_steps.map((step, index) => (
                  <p key={`${step}-${index}`}>{index + 1}. {step}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
