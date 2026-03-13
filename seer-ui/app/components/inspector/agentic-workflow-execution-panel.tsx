"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Filter } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  listAgenticWorkflowExecutions,
  listRegisteredAgenticWorkflows,
} from "@/app/lib/api/agentic-workflows";
import { useOntologyDisplay } from "@/app/lib/ontology-display";
import type {
  AgenticWorkflowCapabilityOption,
  AgenticWorkflowExecutionSummary,
  AgenticWorkflowStatus,
} from "@/app/types/agentic-workflows";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SearchableSelect } from "../ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const PAGE_SIZE = 20;
const ALL_WORKFLOWS_VALUE = "__all_workflows__";
const STATUS_OPTIONS: Array<{ value: AgenticWorkflowStatus; label: string }> = [
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "retry_wait", label: "Retry Wait" },
  { value: "failed_terminal", label: "Failed" },
  { value: "dead_letter", label: "Dead Letter" },
  { value: "queued", label: "Queued" },
];

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "-";
  return parsed.toLocaleString();
}

function toDateTimeLocalValue(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "";
  const timezoneOffsetMs = parsed.getTimezoneOffset() * 60_000;
  const local = new Date(parsed.getTime() - timezoneOffsetMs);
  return local.toISOString().slice(0, 16);
}

function localDateTimeToIso(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.valueOf())) return undefined;
  return parsed.toISOString();
}

function statusBadgeClass(status: AgenticWorkflowStatus): string {
  switch (status) {
    case "running":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "completed":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "retry_wait":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "failed_terminal":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "dead_letter":
      return "border-rose-200 bg-rose-100 text-rose-800";
    case "queued":
      return "border-slate-200 bg-slate-50 text-slate-700";
    default:
      return "";
  }
}

function totalPages(total: number): number {
  return total <= 0 ? 0 : Math.ceil(total / PAGE_SIZE);
}

function shortIdentifier(value: string | null | undefined, keep = 8): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "Unavailable";
  }
  return trimmed.length <= keep ? trimmed : `${trimmed.slice(0, keep)}...`;
}

function displayDateRangeLabel(after: string, before: string): string {
  if (after && before) {
    return `${formatDateTime(after)} to ${formatDateTime(before)}`;
  }
  if (after) {
    return `After ${formatDateTime(after)}`;
  }
  return `Before ${formatDateTime(before)}`;
}

function summaryCardValueClass(value: string): string {
  return value === "-" ? "text-muted-foreground" : "text-foreground";
}

export function AgenticWorkflowExecutionPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ontologyDisplay = useOntologyDisplay();

  const status = (searchParams.get("status")?.trim() as AgenticWorkflowStatus | null) || null;
  const workflowUri = searchParams.get("workflow_uri")?.trim() || "";
  const submittedAfter = searchParams.get("submitted_after")?.trim() || "";
  const submittedBefore = searchParams.get("submitted_before")?.trim() || "";
  const page = Number.parseInt(searchParams.get("page") || "1", 10);
  const currentPage = Number.isNaN(page) || page < 1 ? 1 : page;

  const [statusDraft, setStatusDraft] = useState<AgenticWorkflowStatus | "all">(
    status || "all"
  );
  const [workflowUriDraft, setWorkflowUriDraft] = useState(workflowUri);
  const [submittedAfterDraft, setSubmittedAfterDraft] = useState(
    toDateTimeLocalValue(submittedAfter)
  );
  const [submittedBeforeDraft, setSubmittedBeforeDraft] = useState(
    toDateTimeLocalValue(submittedBefore)
  );

  const [executions, setExecutions] = useState<AgenticWorkflowExecutionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadedRequestKey, setLoadedRequestKey] = useState("");

  const [workflowOptions, setWorkflowOptions] = useState<AgenticWorkflowCapabilityOption[]>([]);
  const [workflowOptionsLoaded, setWorkflowOptionsLoaded] = useState(false);
  const [workflowOptionsError, setWorkflowOptionsError] = useState<string | null>(null);

  const requestKey = `${status || "all"}|${workflowUri}|${submittedAfter}|${submittedBefore}|${currentPage}`;

  useEffect(() => {
    let active = true;

    listRegisteredAgenticWorkflows()
      .then((options) => {
        if (!active) {
          return;
        }
        setWorkflowOptions(options);
        setWorkflowOptionsError(null);
        setWorkflowOptionsLoaded(true);
      })
      .catch((cause) => {
        if (!active) {
          return;
        }
        setWorkflowOptions([]);
        setWorkflowOptionsError(
          cause instanceof Error ? cause.message : "Failed to load workflow capabilities"
        );
        setWorkflowOptionsLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    listAgenticWorkflowExecutions({
      status: status || undefined,
      workflowUri: workflowUri || undefined,
      page: currentPage,
      size: PAGE_SIZE,
      submittedAfter: submittedAfter || undefined,
      submittedBefore: submittedBefore || undefined,
    })
      .then((response) => {
        if (!active) return;
        setExecutions(response.executions);
        setTotal(response.total);
        setError(null);
        setLoadedRequestKey(requestKey);
      })
      .catch((cause) => {
        if (!active) return;
        setExecutions([]);
        setTotal(0);
        setError(cause instanceof Error ? cause.message : "Failed to load workflow executions");
        setLoadedRequestKey(requestKey);
      });

    return () => {
      active = false;
    };
  }, [currentPage, requestKey, status, submittedAfter, submittedBefore, workflowUri]);

  const resolvedWorkflowOptions = useMemo(() => {
    const options = new Map(
      workflowOptions.map((option) => [
        option.value,
        {
          value: option.value,
          label: ontologyDisplay.displayConcept(option.value, {
            conceptLabel: option.label,
          }),
        },
      ])
    );
    if (workflowUri && !options.has(workflowUri)) {
      options.set(workflowUri, {
        value: workflowUri,
        label: ontologyDisplay.displayConcept(workflowUri),
      });
    }
    return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [ontologyDisplay, workflowOptions, workflowUri]);

  const workflowLabelLookup = useMemo(
    () => new Map(resolvedWorkflowOptions.map((option) => [option.value, option.label])),
    [resolvedWorkflowOptions]
  );

  const loading = loadedRequestKey !== requestKey;
  const visiblePages = useMemo(() => totalPages(total), [total]);
  const visibleError = loadedRequestKey === requestKey ? error : null;

  const activeFilterBadges = useMemo(() => {
    const items: string[] = [];
    if (status) {
      items.push(`Status: ${STATUS_OPTIONS.find((option) => option.value === status)?.label || status}`);
    }
    if (workflowUri) {
      items.push(`Workflow: ${workflowLabelLookup.get(workflowUri) || ontologyDisplay.displayConcept(workflowUri)}`);
    }
    if (submittedAfter || submittedBefore) {
      items.push(`Submitted: ${displayDateRangeLabel(submittedAfter, submittedBefore)}`);
    }
    return items;
  }, [ontologyDisplay, status, submittedAfter, submittedBefore, workflowLabelLookup, workflowUri]);

  const applyFilters = () => {
    const params = new URLSearchParams();
    if (statusDraft !== "all") {
      params.set("status", statusDraft);
    }
    if (workflowUriDraft.trim()) {
      params.set("workflow_uri", workflowUriDraft.trim());
    }
    const afterIso = localDateTimeToIso(submittedAfterDraft);
    const beforeIso = localDateTimeToIso(submittedBeforeDraft);
    if (afterIso) {
      params.set("submitted_after", afterIso);
    }
    if (beforeIso) {
      params.set("submitted_before", beforeIso);
    }
    params.set("page", "1");
    const query = params.toString();
    router.push(query ? `/inspector/agentic-workflows?${query}` : "/inspector/agentic-workflows");
  };

  const clearFilters = () => {
    setStatusDraft("all");
    setWorkflowUriDraft("");
    setSubmittedAfterDraft("");
    setSubmittedBeforeDraft("");
    router.push("/inspector/agentic-workflows");
  };

  const buildExecutionHref = (executionId: string) => {
    const query = searchParams.toString();
    return query
      ? `/inspector/agentic-workflows/${executionId}?${query}`
      : `/inspector/agentic-workflows/${executionId}`;
  };

  const changePage = (nextPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(nextPage));
    router.push(`/inspector/agentic-workflows?${params.toString()}`);
  };

  return (
    <div className="space-y-6" data-agentic-workflow-execution-panel>
      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <Filter className="h-4 w-4" />
              Filters
            </div>
          </div>
          <div className="flex max-w-full flex-wrap gap-2">
            <Badge variant="outline" className="rounded-full px-4 py-2 text-sm font-normal">
              {loading ? "Loading runs..." : `${total} matching runs`}
            </Badge>
            <Badge variant="outline" className="rounded-full px-4 py-2 text-sm font-normal">
              {activeFilterBadges.length === 0 ? "All recent runs" : `${activeFilterBadges.length} active filters`}
            </Badge>
            {activeFilterBadges.length === 0 ? (
              <Badge variant="outline" className="rounded-full bg-muted/20 px-3 py-1 text-xs font-normal">
                Showing all recent workflow runs
              </Badge>
            ) : (
              activeFilterBadges.map((item) => (
                <Badge
                  key={item}
                  variant="outline"
                  className="max-w-full rounded-full bg-muted/20 px-3 py-1 text-xs font-normal"
                  title={item}
                >
                  <span className="truncate">{item}</span>
                </Badge>
              ))
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/15 p-4">
            <Label htmlFor="agentic-status">Status</Label>
            <Select
              value={statusDraft}
              onValueChange={(value) => setStatusDraft(value as AgenticWorkflowStatus | "all")}
            >
              <SelectTrigger id="agentic-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/15 p-4">
            <Label htmlFor="agentic-workflow-uri">Workflow capability</Label>
            <SearchableSelect
              triggerId="agentic-workflow-uri"
              value={workflowUriDraft || ALL_WORKFLOWS_VALUE}
              onValueChange={(value) =>
                setWorkflowUriDraft(value === ALL_WORKFLOWS_VALUE ? "" : value)
              }
              disabled={!workflowOptionsLoaded && resolvedWorkflowOptions.length === 0}
              groups={[
                {
                  label: "Workflow capabilities",
                  options: [
                    { value: ALL_WORKFLOWS_VALUE, label: "All workflow capabilities" },
                    ...resolvedWorkflowOptions,
                  ],
                },
              ]}
              placeholder={
                workflowOptionsLoaded ? "All workflow capabilities" : "Loading capabilities..."
              }
              searchPlaceholder="Search workflow capabilities..."
              emptyMessage="No workflow capabilities found."
            />
            {workflowOptionsError && (
              <p className="text-xs text-muted-foreground">{workflowOptionsError}</p>
            )}
          </div>

          <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/15 p-4">
            <Label htmlFor="agentic-submitted-after">Submitted after</Label>
            <Input
              id="agentic-submitted-after"
              type="datetime-local"
              value={submittedAfterDraft}
              onChange={(event) => setSubmittedAfterDraft(event.target.value)}
            />
          </div>

          <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/15 p-4">
            <Label htmlFor="agentic-submitted-before">Submitted before</Label>
            <Input
              id="agentic-submitted-before"
              type="datetime-local"
              value={submittedBeforeDraft}
              onChange={(event) => setSubmittedBeforeDraft(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={applyFilters}>
            Apply
          </Button>
          <Button type="button" variant="outline" onClick={clearFilters}>
            Reset
          </Button>
        </div>
      </Card>

      {visibleError && (
        <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {visibleError}
        </Card>
      )}

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Workflow Runs
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Page {visiblePages === 0 ? 0 : currentPage} of {visiblePages}
            </p>
          </div>
          <Badge variant="outline" className="rounded-full">
            {total} total
          </Badge>
        </div>

        {executions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {loading ? "Loading workflow runs..." : "No workflow runs match the active filters."}
          </div>
        ) : (
          <div className="space-y-3">
            {executions.map((execution) => {
              const href = buildExecutionHref(execution.action.action_id);
              const workflowLabel = ontologyDisplay.displayConcept(execution.action.action_uri);
              const submittedLabel = formatDateTime(execution.action.submitted_at);
              const updatedLabel = formatDateTime(execution.action.updated_at);
              const lastPersistedLabel = formatDateTime(execution.last_transcript_persisted_at);

              return (
                <Link
                  key={execution.action.action_id}
                  href={href}
                  className="group block rounded-2xl border border-border bg-muted/10 p-5 shadow-sm transition hover:border-foreground/20 hover:bg-muted/20 focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        Workflow capability
                      </div>
                      <div className="truncate font-display text-xl">{workflowLabel}</div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span title={execution.action.action_id}>
                          Run {shortIdentifier(execution.action.action_id, 10)}
                        </span>
                        {execution.action.parent_execution_id && (
                          <span title={execution.action.parent_execution_id}>
                            Child of {shortIdentifier(execution.action.parent_execution_id, 10)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge
                        variant="outline"
                        className={`rounded-full ${statusBadgeClass(execution.action.status)}`}
                      >
                        {execution.action.status}
                      </Badge>
                      <Badge variant="outline" className="rounded-full">
                        {execution.transcript_message_count} messages
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-border/70 bg-background/80 p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        Submitted
                      </div>
                      <div className={`mt-1 text-sm font-medium ${summaryCardValueClass(submittedLabel)}`}>
                        {submittedLabel}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/80 p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        Updated
                      </div>
                      <div className={`mt-1 text-sm font-medium ${summaryCardValueClass(updatedLabel)}`}>
                        {updatedLabel}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/80 p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        Transcript
                      </div>
                      <div className="mt-1 text-sm font-medium">
                        {execution.transcript_message_count} persisted
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{lastPersistedLabel}</div>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/80 p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        Attempts
                      </div>
                      <div className="mt-1 text-sm font-medium">
                        {execution.action.attempt_count} / {execution.action.max_attempts}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-4 border-t border-border/70 pt-3">
                    <div className="min-w-0 text-[11px] text-muted-foreground">
                      <div className="uppercase tracking-[0.18em]">Capability URI</div>
                      <div className="truncate" title={execution.action.action_uri}>
                        {execution.action.action_uri}
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-1 text-sm font-medium text-foreground">
                      Open run
                      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {loading ? "Refreshing workflow runs..." : "Transcript counts reflect persisted messages."}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={currentPage <= 1}
              onClick={() => changePage(currentPage - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={visiblePages === 0 || currentPage >= visiblePages}
              onClick={() => changePage(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
