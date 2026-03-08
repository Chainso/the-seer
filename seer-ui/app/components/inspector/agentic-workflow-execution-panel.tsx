"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bot, Filter, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { listAgenticWorkflowExecutions } from "@/app/lib/api/agentic-workflows";
import type {
  AgenticWorkflowExecutionSummary,
  AgenticWorkflowStatus,
} from "@/app/types/agentic-workflows";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Table } from "../ui/table";

const PAGE_SIZE = 20;
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

export function AgenticWorkflowExecutionPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const userId = searchParams.get("user_id")?.trim() || "";
  const status = (searchParams.get("status")?.trim() as AgenticWorkflowStatus | null) || null;
  const workflowUri = searchParams.get("workflow_uri")?.trim() || "";
  const search = searchParams.get("search")?.trim() || "";
  const submittedAfter = searchParams.get("submitted_after")?.trim() || "";
  const submittedBefore = searchParams.get("submitted_before")?.trim() || "";
  const page = Number.parseInt(searchParams.get("page") || "1", 10);
  const currentPage = Number.isNaN(page) || page < 1 ? 1 : page;

  const [userIdDraft, setUserIdDraft] = useState(userId);
  const [statusDraft, setStatusDraft] = useState<AgenticWorkflowStatus | "all">(
    status || "all"
  );
  const [workflowUriDraft, setWorkflowUriDraft] = useState(workflowUri);
  const [searchDraft, setSearchDraft] = useState(search);
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

  const requestKey = `${userId}|${status || "all"}|${workflowUri}|${search}|${submittedAfter}|${submittedBefore}|${currentPage}`;

  useEffect(() => {
    let active = true;
    if (!userId) {
      return () => {
        active = false;
      };
    }

    listAgenticWorkflowExecutions({
      userId,
      status: status || undefined,
      workflowUri: workflowUri || undefined,
      search: search || undefined,
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
  }, [requestKey, currentPage, search, status, submittedAfter, submittedBefore, userId, workflowUri]);

  const loading = Boolean(userId) && loadedRequestKey !== requestKey;
  const visibleExecutions = userId ? executions : [];
  const visibleTotal = userId ? total : 0;
  const visiblePages = useMemo(() => totalPages(visibleTotal), [visibleTotal]);
  const visibleError = loadedRequestKey === requestKey ? error : null;

  const applyFilters = () => {
    const params = new URLSearchParams();
    const trimmedUserId = userIdDraft.trim();
    if (trimmedUserId) {
      params.set("user_id", trimmedUserId);
    }
    if (statusDraft !== "all") {
      params.set("status", statusDraft);
    }
    if (workflowUriDraft.trim()) {
      params.set("workflow_uri", workflowUriDraft.trim());
    }
    if (searchDraft.trim()) {
      params.set("search", searchDraft.trim());
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

  const openExecution = (executionId: string) => {
    const params = new URLSearchParams();
    if (userId) {
      params.set("user_id", userId);
    }
    const query = params.toString();
    router.push(
      query
        ? `/inspector/agentic-workflows/${executionId}?${query}`
        : `/inspector/agentic-workflows/${executionId}`
    );
  };

  const changePage = (nextPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(nextPage));
    router.push(`/inspector/agentic-workflows?${params.toString()}`);
  };

  return (
    <div className="space-y-6" data-agentic-workflow-execution-panel>
      <Card className="rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Agentic Workflows
            </p>
            <h1 className="font-display text-3xl">Execution History + Live Tail</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Inspect agentic workflow executions as a dedicated history surface. Filter by user,
              workflow, and runtime state, then drill into persisted transcripts, child actions,
              and produced events.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="rounded-full">
                Persisted transcripts only
              </Badge>
              <Badge variant="outline" className="rounded-full">
                Child execution lineage
              </Badge>
              <Badge variant="outline" className="rounded-full">
                Produced-event provenance
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground">
            <Bot className="h-4 w-4" />
            {loading ? "Loading executions..." : `${visibleTotal} matching executions`}
          </div>
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Filter className="h-4 w-4" />
          Filters
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="agentic-user-id">User ID</Label>
            <Input
              id="agentic-user-id"
              placeholder="user-id"
              value={userIdDraft}
              onChange={(event) => setUserIdDraft(event.target.value)}
            />
          </div>

          <div className="space-y-2">
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

          <div className="space-y-2">
            <Label htmlFor="agentic-workflow-uri">Workflow URI</Label>
            <Input
              id="agentic-workflow-uri"
              placeholder="urn:seer:test:workflow.invoice.overdue"
              value={workflowUriDraft}
              onChange={(event) => setWorkflowUriDraft(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agentic-search">Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="agentic-search"
                className="pl-8"
                placeholder="Search workflow identifier"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="agentic-submitted-after">Submitted After</Label>
            <Input
              id="agentic-submitted-after"
              type="datetime-local"
              value={submittedAfterDraft}
              onChange={(event) => setSubmittedAfterDraft(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agentic-submitted-before">Submitted Before</Label>
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
            Apply Filters
          </Button>
          <p className="text-xs text-muted-foreground">
            User ID is currently required because execution queries are still keyed to the generic
            action control plane.
          </p>
        </div>
      </Card>

      {visibleError && (
        <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {visibleError}
        </Card>
      )}

      {!userId ? (
        <Card className="rounded-2xl border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
          Enter a user ID to load agentic workflow executions.
        </Card>
      ) : (
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Workflow Executions
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Page {visiblePages === 0 ? 0 : currentPage} of {visiblePages}
              </p>
            </div>
            <Badge variant="outline" className="rounded-full">
              {visibleTotal} total
            </Badge>
          </div>

          <Table.Root striped>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Workflow</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Submitted</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Updated</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Transcript</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Attempts</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="w-[120px]">Inspect</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {visibleExecutions.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={7} className="py-10 text-center text-muted-foreground">
                    {loading ? "Loading workflow executions..." : "No executions match the current filters."}
                  </Table.Cell>
                </Table.Row>
              ) : (
                visibleExecutions.map((execution) => (
                  <Table.Row key={execution.action.action_id}>
                    <Table.RowHeaderCell className="max-w-[440px]">
                      <div className="space-y-1">
                        <div className="truncate font-medium">{execution.action.action_uri}</div>
                        <div className="text-xs text-muted-foreground">
                          {execution.action.action_id}
                        </div>
                      </div>
                    </Table.RowHeaderCell>
                    <Table.Cell>
                      <Badge
                        variant="outline"
                        className={`rounded-full ${statusBadgeClass(execution.action.status)}`}
                      >
                        {execution.action.status}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>{formatDateTime(execution.action.submitted_at)}</Table.Cell>
                    <Table.Cell>{formatDateTime(execution.action.updated_at)}</Table.Cell>
                    <Table.Cell>
                      <div className="space-y-1">
                        <div>{execution.transcript_message_count} messages</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDateTime(execution.last_transcript_persisted_at)}
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      {execution.action.attempt_count} / {execution.action.max_attempts}
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openExecution(execution.action.action_id)}
                      >
                        Open
                        <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table.Root>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {loading ? "Refreshing execution list..." : "Execution statuses come from the action control plane."}
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
      )}
    </div>
  );
}
