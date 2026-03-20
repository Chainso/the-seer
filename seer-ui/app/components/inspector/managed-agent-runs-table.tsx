"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Filter, Search } from "lucide-react";

import { listAgenticWorkflowExecutions } from "@/app/lib/api/agentic-workflows";
import { useOntologyDisplay } from "@/app/lib/ontology-display";
import type {
  AgenticWorkflowExecutionSummary,
  AgenticWorkflowStatus,
} from "@/app/types/agentic-workflows";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  TableBody,
  TableCell,
  TableColumnHeaderCell,
  TableHeader,
  TableRoot,
  TableRow,
} from "../ui/table";

const PAGE_SIZE = 10;

const STATUS_OPTIONS: Array<{ value: AgenticWorkflowStatus; label: string }> = [
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "retry_wait", label: "Retry Wait" },
  { value: "failed_terminal", label: "Failed" },
  { value: "dead_letter", label: "Dead Letter" },
  { value: "queued", label: "Queued" },
];

interface ManagedAgentRunsTableProps {
  managedAgentKey: string;
  actionUri: string;
  buildRunHref: (executionId: string) => string;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return "-";
  }
  return parsed.toLocaleString();
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

function shortIdentifier(value: string, keep = 10): string {
  return value.length <= keep ? value : `${value.slice(0, keep)}...`;
}

function totalPages(total: number): number {
  return total <= 0 ? 0 : Math.ceil(total / PAGE_SIZE);
}

export function ManagedAgentRunsTable({
  managedAgentKey,
  actionUri,
  buildRunHref,
}: ManagedAgentRunsTableProps) {
  const ontologyDisplay = useOntologyDisplay();
  const [status, setStatus] = useState<AgenticWorkflowStatus | "all">("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const [executions, setExecutions] = useState<AgenticWorkflowExecutionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadExecutions = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await listAgenticWorkflowExecutions({
        actionUri,
        status: status === "all" ? undefined : status,
        search: deferredSearch || undefined,
        page,
        size: PAGE_SIZE,
      });
      if (requestId !== requestIdRef.current) {
        return;
      }
      setExecutions(response.executions);
      setTotal(response.total);
      setError(null);
    } catch (cause) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setExecutions([]);
      setTotal(0);
      setError(cause instanceof Error ? cause.message : "Failed to load managed-agent runs");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [actionUri, deferredSearch, page, status]);

  useEffect(() => {
    void loadExecutions();
  }, [loadExecutions]);

  const visiblePages = useMemo(() => totalPages(total), [total]);
  const actionLabel = ontologyDisplay.displayConcept(actionUri);

  return (
    <div className="space-y-5" data-managed-agent-runs-table={managedAgentKey}>
      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <Filter className="h-4 w-4" />
              Runs
            </div>
            <p className="text-sm text-muted-foreground">
              Showing runs for <span className="font-medium text-foreground">{actionLabel}</span>.
            </p>
          </div>
          <Badge variant="outline" className="rounded-full">
            {loading ? "Loading..." : `${total} total`}
          </Badge>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[0.7fr_1.3fr]">
          <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/15 p-4">
            <label htmlFor="managed-agent-runs-status" className="text-sm font-medium">
              Status
            </label>
            <Select
              value={status}
              onValueChange={(value) => {
                setPage(1);
                setStatus(value as AgenticWorkflowStatus | "all");
              }}
            >
              <SelectTrigger id="managed-agent-runs-status" className="w-full">
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
            <label htmlFor="managed-agent-runs-search" className="text-sm font-medium">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="managed-agent-runs-search"
                value={search}
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
                placeholder="Search run IDs, errors, or action URIs..."
                className="pl-9"
              />
            </div>
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        {loading ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Loading managed-agent runs...
          </div>
        ) : executions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No runs match the current filters for this managed agent.
          </div>
        ) : (
          <TableRoot variant="surface" layout="fixed" striped>
            <TableHeader>
              <TableRow>
                <TableColumnHeaderCell className="w-[12%]">Status</TableColumnHeaderCell>
                <TableColumnHeaderCell className="w-[18%]">Run</TableColumnHeaderCell>
                <TableColumnHeaderCell className="w-[18%]">Submitted</TableColumnHeaderCell>
                <TableColumnHeaderCell className="w-[18%]">Updated</TableColumnHeaderCell>
                <TableColumnHeaderCell className="w-[14%]">Transcript</TableColumnHeaderCell>
                <TableColumnHeaderCell className="w-[10%]">Attempts</TableColumnHeaderCell>
                <TableColumnHeaderCell className="w-[10%]">Open</TableColumnHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {executions.map((execution) => (
                <TableRow key={execution.action.action_id}>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`rounded-full ${statusBadgeClass(execution.action.status)}`}
                    >
                      {execution.action.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium">
                        {shortIdentifier(execution.action.action_id, 12)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {execution.action.parent_execution_id
                          ? `Child of ${shortIdentifier(execution.action.parent_execution_id, 10)}`
                          : "Top-level run"}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(execution.action.submitted_at)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(execution.action.updated_at)}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium">
                        {execution.transcript_message_count} persisted
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(execution.last_transcript_persisted_at)}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {execution.action.attempt_count} / {execution.action.max_attempts}
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="outline" className="w-full justify-between">
                      <Link href={buildRunHref(execution.action.action_id)}>
                        Open
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableRoot>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Page {visiblePages === 0 ? 0 : page} of {visiblePages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={visiblePages === 0 || page >= visiblePages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
