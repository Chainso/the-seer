"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Clock3, RadioTower, Rows3, Waypoints } from "lucide-react";
import { useSearchParams } from "next/navigation";

import {
  getAgenticWorkflowExecution,
  listAgenticWorkflowMessages,
  streamAgenticWorkflowMessages,
} from "@/app/lib/api/agentic-workflows";
import { useOntologyDisplay } from "@/app/lib/ontology-display";
import type {
  AgenticWorkflowActionSummary,
  AgenticWorkflowExecutionDetailResponse,
  AgenticWorkflowProducedEvent,
  AgenticWorkflowStatus,
  AgenticWorkflowTranscriptMessage,
  AgenticWorkflowTranscriptSnapshotEvent,
} from "@/app/types/agentic-workflows";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

type TranscriptMessageGroup = {
  dayKey: string;
  dayLabel: string;
  entries: AgenticWorkflowTranscriptMessage[];
};

type MessageHighlight = {
  key: string;
  label: string;
  value: string;
};

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "-";
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

function roleBadgeClass(role: AgenticWorkflowTranscriptMessage["role"]): string {
  switch (role) {
    case "assistant":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "tool":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "user":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "system":
      return "border-slate-200 bg-slate-100 text-slate-700";
    default:
      return "border-border bg-background text-foreground";
  }
}

function transcriptCardClass(role: AgenticWorkflowTranscriptMessage["role"]): string {
  switch (role) {
    case "assistant":
      return "border-blue-100 bg-blue-50/30";
    case "tool":
      return "border-amber-100 bg-amber-50/30";
    case "user":
      return "border-emerald-100 bg-emerald-50/30";
    case "system":
      return "border-slate-200 bg-slate-50/70";
    default:
      return "border-border bg-card";
  }
}

function mergeMessages(
  existing: AgenticWorkflowTranscriptMessage[],
  incoming: AgenticWorkflowTranscriptMessage[]
): AgenticWorkflowTranscriptMessage[] {
  const merged = new Map<number, AgenticWorkflowTranscriptMessage>();
  existing.forEach((message) => merged.set(message.ordinal, message));
  incoming.forEach((message) => merged.set(message.ordinal, message));
  return [...merged.values()].sort((left, right) => left.ordinal - right.ordinal);
}

function serializeMessage(message: Record<string, unknown>): string {
  return JSON.stringify(message, null, 2);
}

function shortIdentifier(value: string | null | undefined, keep = 10): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "Unavailable";
  }
  return trimmed.length <= keep ? trimmed : `${trimmed.slice(0, keep)}...`;
}

function truncateText(value: string, maxLength = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function updateExecutionStatus(
  detail: AgenticWorkflowExecutionDetailResponse | null,
  snapshot: AgenticWorkflowTranscriptSnapshotEvent
): AgenticWorkflowExecutionDetailResponse | null {
  if (!detail) return detail;
  return {
    ...detail,
    execution: {
      ...detail.execution,
      action: {
        ...detail.execution.action,
        status: snapshot.status,
        attempt_count: snapshot.attempt_count,
        updated_at: snapshot.updated_at,
      },
      transcript_message_count: Math.max(detail.execution.transcript_message_count, snapshot.last_ordinal),
    },
  };
}

function groupTranscriptMessages(
  messages: AgenticWorkflowTranscriptMessage[]
): TranscriptMessageGroup[] {
  const groups: TranscriptMessageGroup[] = [];

  messages.forEach((message) => {
    const persisted = new Date(message.persisted_at);
    const isValid = !Number.isNaN(persisted.valueOf());
    const dayKey = isValid
      ? `${persisted.getFullYear()}-${persisted.getMonth()}-${persisted.getDate()}`
      : "unknown-day";
    const dayLabel = isValid
      ? persisted.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "Unknown day";

    const current = groups[groups.length - 1];
    if (!current || current.dayKey !== dayKey) {
      groups.push({ dayKey, dayLabel, entries: [message] });
      return;
    }
    current.entries.push(message);
  });

  return groups;
}

function SummaryStat({
  label,
  value,
  supporting,
}: {
  label: string;
  value: string;
  supporting?: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
      {supporting ? <div className="mt-1 text-xs text-muted-foreground">{supporting}</div> : null}
    </div>
  );
}

function ExecutionRunCard({
  eyebrow,
  action,
  href,
  displayActionLabel,
  isCurrent = false,
}: {
  eyebrow: string;
  action: AgenticWorkflowActionSummary;
  href?: string;
  displayActionLabel: (action: AgenticWorkflowActionSummary) => string;
  isCurrent?: boolean;
}) {
  const targetHref = !isCurrent && href ? href : null;

  const content = (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-background/80 p-4 text-left">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {eyebrow}
        </div>
        <div className="truncate font-medium">{displayActionLabel(action)}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span title={action.action_id}>Run {shortIdentifier(action.action_id, 10)}</span>
          <span>{formatDateTime(action.updated_at)}</span>
          <span>{action.action_kind}</span>
          {!targetHref && !isCurrent ? <span>No workflow detail route</span> : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={`rounded-full ${statusBadgeClass(action.status)}`}>
          {action.status}
        </Badge>
        {targetHref ? (
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        ) : null}
      </div>
    </div>
  );

  if (!targetHref) {
    return content;
  }

  return (
    <Link
      href={targetHref}
      className="block rounded-2xl transition hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {content}
    </Link>
  );
}

export function AgenticWorkflowExecutionDetailsPanel({
  executionId,
}: {
  executionId: string;
}) {
  const searchParams = useSearchParams();
  const ontologyDisplay = useOntologyDisplay();

  const [detail, setDetail] = useState<AgenticWorkflowExecutionDetailResponse | null>(null);
  const [messages, setMessages] = useState<AgenticWorkflowTranscriptMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AgenticWorkflowTranscriptSnapshotEvent | null>(null);

  const lastOrdinalRef = useRef(0);
  const [streamReady, setStreamReady] = useState(false);

  useEffect(() => {
    let active = true;

    Promise.all([
      getAgenticWorkflowExecution(executionId),
      listAgenticWorkflowMessages({ executionId, limit: 500 }),
    ])
      .then(([detailResponse, messagesResponse]) => {
        if (!active) return;
        setDetail(detailResponse);
        setMessages(messagesResponse.messages);
        lastOrdinalRef.current = messagesResponse.last_ordinal;
        setError(null);
        setStreamError(null);
        setStreamReady(true);
      })
      .catch((cause) => {
        if (!active) return;
        setDetail(null);
        setMessages([]);
        setError(cause instanceof Error ? cause.message : "Failed to load workflow execution");
        setStreamReady(false);
      });

    return () => {
      active = false;
    };
  }, [executionId]);

  useEffect(() => {
    if (!streamReady) {
      return;
    }
    const controller = new AbortController();

    void streamAgenticWorkflowMessages(
      {
        executionId,
        afterOrdinal: lastOrdinalRef.current,
        pollIntervalMs: 500,
        limit: 200,
      },
      {
        onSnapshot: (payload) => {
          lastOrdinalRef.current = payload.last_ordinal;
          setSnapshot(payload);
          setDetail((previous) => updateExecutionStatus(previous, payload));
        },
        onMessage: (message) => {
          lastOrdinalRef.current = Math.max(lastOrdinalRef.current, message.ordinal);
          setMessages((previous) => mergeMessages(previous, [message]));
          setDetail((previous) => {
            if (!previous) return previous;
            return {
              ...previous,
              execution: {
                ...previous.execution,
                transcript_message_count: Math.max(
                  previous.execution.transcript_message_count,
                  message.ordinal
                ),
              },
            };
          });
        },
        onTerminal: (payload) => {
          lastOrdinalRef.current = payload.last_ordinal;
          setSnapshot(payload);
          setDetail((previous) => updateExecutionStatus(previous, payload));
        },
        onError: (payload) => {
          if (typeof payload.message === "string" && payload.message.trim()) {
            setStreamError(payload.message);
          }
        },
      },
      controller.signal
    ).catch((cause) => {
      if (controller.signal.aborted) {
        return;
      }
      setStreamError(cause instanceof Error ? cause.message : "Live transcript stream failed");
    });

    return () => {
      controller.abort();
    };
  }, [executionId, streamReady]);

  const query = useMemo(() => searchParams.toString(), [searchParams]);
  const backHref = useMemo(
    () => (query ? `/inspector/agentic-workflows?${query}` : "/inspector/agentic-workflows"),
    [query]
  );
  const buildExecutionHref = (targetExecutionId: string) =>
    query
      ? `/inspector/agentic-workflows/${targetExecutionId}?${query}`
      : `/inspector/agentic-workflows/${targetExecutionId}`;
  const buildExecutionHrefForAction = (action: AgenticWorkflowActionSummary) =>
    action.action_kind === "agentic_workflow" ? buildExecutionHref(action.action_id) : undefined;

  const currentStatus = detail?.execution.action.status || snapshot?.status;
  const lastOrdinal = snapshot?.last_ordinal || messages[messages.length - 1]?.ordinal || 0;
  const loading = !detail && !error;

  const executionLookupById = useMemo(() => {
    const entries: AgenticWorkflowActionSummary[] = [];
    if (detail?.execution?.action) {
      entries.push(detail.execution.action);
    }
    if (detail?.parent_execution) {
      entries.push(detail.parent_execution);
    }
    if (detail?.child_executions?.length) {
      entries.push(...detail.child_executions);
    }
    return new Map(entries.map((action) => [action.action_id, action]));
  }, [detail]);

  const transcriptGroups = useMemo(() => groupTranscriptMessages(messages), [messages]);

  const displayActionLabel = (action: AgenticWorkflowActionSummary) =>
    ontologyDisplay.displayConcept(action.action_uri);

  const displayProducedBy = (event: AgenticWorkflowProducedEvent): string => {
    if (!event.produced_by_execution_id) {
      return "External source";
    }
    const action = executionLookupById.get(event.produced_by_execution_id);
    if (!action) {
      return `Run ${shortIdentifier(event.produced_by_execution_id, 10)}`;
    }
    return displayActionLabel(action);
  };

  const summarizeMessageContent = (message: AgenticWorkflowTranscriptMessage): string => {
    const content = message.message.content;
    if (typeof content === "string" && content.trim().length > 0) {
      return truncateText(content, 180);
    }

    if (message.role === "tool" && typeof message.message.name === "string") {
      return `Result from ${ontologyDisplay.displayConcept(message.message.name)}`;
    }

    if (Array.isArray(message.message.tool_calls) && message.message.tool_calls.length > 0) {
      const firstCall = message.message.tool_calls[0];
      const functionName =
        typeof firstCall === "object" &&
        firstCall !== null &&
        "function" in firstCall &&
        typeof firstCall.function === "object" &&
        firstCall.function !== null &&
        "name" in firstCall.function &&
        typeof firstCall.function.name === "string"
          ? firstCall.function.name
          : null;
      if (functionName) {
        return `Calls ${ontologyDisplay.displayConcept(functionName)}`;
      }
      return `${message.message.tool_calls.length} tool call(s)`;
    }

    if (typeof message.message.name === "string" && message.message.name.trim().length > 0) {
      return `Activity for ${ontologyDisplay.displayConcept(message.message.name)}`;
    }

    return "Structured message payload";
  };

  const previewMessageContent = (message: AgenticWorkflowTranscriptMessage): string | null => {
    const content = message.message.content;
    if (typeof content !== "string" || !content.trim()) {
      return null;
    }
    return truncateText(content, 320);
  };

  const messageHighlights = (message: AgenticWorkflowTranscriptMessage): MessageHighlight[] => {
    const highlights: MessageHighlight[] = [];

    if (typeof message.message.name === "string" && message.message.name.trim()) {
      highlights.push({
        key: "name",
        label: message.role === "tool" ? "Tool" : "Activity",
        value: ontologyDisplay.displayConcept(message.message.name),
      });
    }

    if (Array.isArray(message.message.tool_calls) && message.message.tool_calls.length > 0) {
      const firstCall = message.message.tool_calls[0];
      const functionName =
        typeof firstCall === "object" &&
        firstCall !== null &&
        "function" in firstCall &&
        typeof firstCall.function === "object" &&
        firstCall.function !== null &&
        "name" in firstCall.function &&
        typeof firstCall.function.name === "string"
          ? firstCall.function.name
          : null;

      highlights.push({
        key: "tool_calls",
        label: "Tool calls",
        value: `${message.message.tool_calls.length}`,
      });

      if (functionName) {
        highlights.push({
          key: "first_tool",
          label: "First tool",
          value: ontologyDisplay.displayConcept(functionName),
        });
      }
    }

    if (message.call_id) {
      highlights.push({
        key: "call_id",
        label: "Call",
        value: shortIdentifier(message.call_id, 12),
      });
    }

    return highlights.slice(0, 3);
  };

  if (loading) {
    return (
      <Card className="rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground">
        Loading workflow run...
      </Card>
    );
  }

  if (error || !detail) {
    return (
      <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-8 text-sm text-destructive">
        {error || "Workflow execution not found."}
      </Card>
    );
  }

  const currentAction = detail.execution.action;
  const workflowLabel = ontologyDisplay.displayConcept(currentAction.action_uri);
  const transcriptCountLabel = `${messages.length} loaded / ${detail.execution.transcript_message_count} persisted`;
  const producedEventCountLabel =
    detail.produced_events.length === 1
      ? "1 produced event"
      : `${detail.produced_events.length} produced events`;
  const lineageLabel = detail.parent_execution
    ? `${detail.child_executions.length} child runs + parent context`
    : `${detail.child_executions.length} child runs`;

  return (
    <div className="space-y-6" data-agentic-workflow-execution-details-panel>
      <Card className="rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Agentic Workflow Run
            </p>
            <h1 className="font-display text-3xl">{workflowLabel}</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Review persisted transcript history, related actions, and produced events for this
              workflow execution.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className={`rounded-full ${statusBadgeClass(currentStatus || currentAction.status)}`}
              >
                {currentStatus || currentAction.status}
              </Badge>
              <Badge variant="outline" className="rounded-full">
                Run {shortIdentifier(currentAction.action_id, 10)}
              </Badge>
              <Badge variant="outline" className="rounded-full">
                {snapshot?.terminal ? "Completed stream" : "Live updates"}
              </Badge>
            </div>
          </div>
          <Button asChild variant="outline">
            <Link href={backHref}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Runs
            </Link>
          </Button>
        </div>
      </Card>

      {streamError && (
        <Card className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {streamError}
        </Card>
      )}

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <RadioTower className="h-4 w-4" />
              Run Summary
            </div>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Start here for the workflow identity, current state, lineage, and recent execution
              activity before drilling into raw transcript detail.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-full">
              {producedEventCountLabel}
            </Badge>
            <Badge variant="outline" className="rounded-full">
              {lineageLabel}
            </Badge>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <SummaryStat
            label="Workflow Capability"
            value={workflowLabel}
            supporting={`Run ${shortIdentifier(currentAction.action_id, 10)}`}
          />
          <SummaryStat
            label="Transcript"
            value={transcriptCountLabel}
            supporting={`Last ordinal ${lastOrdinal}`}
          />
          <SummaryStat
            label="Attempts"
            value={`${currentAction.attempt_count} / ${currentAction.max_attempts}`}
            supporting={currentAction.completed_at ? "Execution reached completion state" : "Execution still mutable"}
          />
          <SummaryStat
            label="Updated"
            value={formatDateTime(currentAction.updated_at)}
            supporting={`Submitted ${formatDateTime(currentAction.submitted_at)}`}
          />
          <SummaryStat
            label="Lineage"
            value={`${detail.child_executions.length} child runs`}
            supporting={detail.parent_execution ? "Parent run linked" : "Top-level workflow run"}
          />
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <Waypoints className="h-4 w-4" />
              Related Actions
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Browse parent and child runs directly from the execution chain instead of reading the
              transcript first.
            </p>

            <div className="mt-4 space-y-3">
              {detail.parent_execution ? (
                <ExecutionRunCard
                  eyebrow="Parent run"
                  action={detail.parent_execution}
                  href={buildExecutionHrefForAction(detail.parent_execution)}
                  displayActionLabel={displayActionLabel}
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No parent run is linked to this execution.
                </div>
              )}

              <ExecutionRunCard
                eyebrow="Current run"
                action={currentAction}
                displayActionLabel={displayActionLabel}
                isCurrent
              />

              {detail.child_executions.length > 0 ? (
                detail.child_executions.map((action) => (
                  <ExecutionRunCard
                    key={action.action_id}
                    eyebrow="Child run"
                    action={action}
                    href={buildExecutionHrefForAction(action)}
                    displayActionLabel={displayActionLabel}
                  />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  This workflow run has not launched any child ontology actions yet.
                </div>
              )}
            </div>
          </div>

          <details className="rounded-2xl border border-border/70 bg-muted/15 p-4">
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Supporting Detail
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              Raw identifiers and control-plane metadata stay available here without dominating the
              main reading path.
            </p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Workflow URI
                </dt>
                <dd className="mt-1 break-all text-xs text-muted-foreground">
                  {currentAction.action_uri}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Execution ID
                </dt>
                <dd className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {currentAction.action_id}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  User ID
                </dt>
                <dd className="mt-1 break-all text-xs text-muted-foreground">
                  {currentAction.user_id}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Completed
                </dt>
                <dd className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(currentAction.completed_at)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Lease owner
                </dt>
                <dd className="mt-1 break-all text-xs text-muted-foreground">
                  {currentAction.lease_owner_instance_id || "Unavailable"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Lease expires
                </dt>
                <dd className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(currentAction.lease_expires_at)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Last error code
                </dt>
                <dd className="mt-1 break-all text-xs text-muted-foreground">
                  {currentAction.last_error_code || "None"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Last error detail
                </dt>
                <dd className="mt-1 break-words text-xs text-muted-foreground">
                  {currentAction.last_error_detail || "None"}
                </dd>
              </div>
            </dl>
          </details>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <Rows3 className="h-4 w-4" />
                Transcript
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Transcript entries are grouped by day and summarized first. Raw payloads and full
                IDs stay available in supporting detail for audit work.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="rounded-full">
                Last ordinal {lastOrdinal}
              </Badge>
              <Badge variant="outline" className="rounded-full">
                {snapshot?.terminal ? "Terminal" : "Live tailing"}
              </Badge>
            </div>
          </div>

          {messages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-sm text-muted-foreground">
              No persisted transcript messages yet.
            </div>
          ) : (
            <div className="space-y-5">
              {transcriptGroups.map((group) => (
                <section key={group.dayKey} className="space-y-3">
                  <div className="sticky top-0 z-[1] rounded-md bg-card/90 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground backdrop-blur">
                    {group.dayLabel}
                  </div>
                  <div className="relative space-y-3 pl-5">
                    <div className="pointer-events-none absolute bottom-2 left-1 top-2 w-px bg-border/70" />
                    {group.entries.map((message) => {
                      const summary = summarizeMessageContent(message);
                      const preview = previewMessageContent(message);
                      const highlights = messageHighlights(message);

                      return (
                        <div key={message.ordinal} className="relative">
                          <span className="absolute -left-[19px] top-5 h-2.5 w-2.5 rounded-full border border-border bg-card" />
                          <article
                            className={`rounded-2xl border p-4 shadow-sm ${transcriptCardClass(message.role)}`}
                          >
                            <header className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant="outline"
                                    className={`rounded-full uppercase ${roleBadgeClass(message.role)}`}
                                  >
                                    {message.role}
                                  </Badge>
                                  <Badge variant="outline" className="rounded-full">
                                    attempt {message.attempt_no}
                                  </Badge>
                                  {message.message_kind && (
                                    <Badge variant="outline" className="rounded-full">
                                      {message.message_kind}
                                    </Badge>
                                  )}
                                </div>
                                <div className="font-display text-sm">{summary}</div>
                                <div className="text-xs text-muted-foreground">
                                  Persisted {formatDateTime(message.persisted_at)}
                                </div>
                              </div>
                              <Badge variant="outline" className="rounded-full">
                                #{message.ordinal}
                              </Badge>
                            </header>

                            {highlights.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {highlights.map((highlight) => (
                                  <span
                                    key={`${message.ordinal}-${highlight.key}`}
                                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background/90 px-2.5 py-1 text-[11px] text-foreground"
                                    title={`${highlight.label}: ${highlight.value}`}
                                  >
                                    <span className="text-muted-foreground">{highlight.label}</span>
                                    <span className="truncate">{highlight.value}</span>
                                  </span>
                                ))}
                              </div>
                            )}

                            {preview && preview !== summary ? (
                              <p className="mt-3 whitespace-pre-wrap break-words text-sm text-foreground/90">
                                {preview}
                              </p>
                            ) : null}

                            <details className="mt-3 rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                                Supporting detail and raw payload
                              </summary>
                              <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                                <div>
                                  <dt className="uppercase tracking-[0.18em]">Workflow URI</dt>
                                  <dd className="mt-1 break-all">{message.workflow_uri}</dd>
                                </div>
                                <div>
                                  <dt className="uppercase tracking-[0.18em]">Execution ID</dt>
                                  <dd className="mt-1 break-all font-mono">{message.execution_id}</dd>
                                </div>
                                <div>
                                  <dt className="uppercase tracking-[0.18em]">Sequence</dt>
                                  <dd className="mt-1">
                                    seq {message.sequence_no} / ordinal {message.ordinal}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="uppercase tracking-[0.18em]">Call ID</dt>
                                  <dd className="mt-1 break-all">{message.call_id || "Unavailable"}</dd>
                                </div>
                              </dl>
                              <pre className="mt-3 overflow-x-auto rounded-xl bg-background p-3 text-xs text-muted-foreground">
                                {serializeMessage(message.message)}
                              </pre>
                            </details>
                          </article>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </Card>

        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <Clock3 className="h-4 w-4" />
            Produced Events
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Event cards keep ontology-aware identity and provenance up front, with raw event IDs and
            payloads tucked into supporting detail.
          </p>

          {detail.produced_events.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              No produced events recorded for this execution chain yet.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {detail.produced_events.map((event) => (
                <article
                  key={event.event_id}
                  className="rounded-2xl border border-border bg-muted/10 p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        Event
                      </div>
                      <div className="truncate font-medium">
                        {ontologyDisplay.displayEventType(event.event_type)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Produced by {displayProducedBy(event)}
                      </div>
                    </div>
                    <Badge variant="outline" className="rounded-full">
                      {formatDateTime(event.occurred_at)}
                    </Badge>
                  </div>

                  <p className="mt-3 text-xs text-muted-foreground">
                    {ontologyDisplay.summarizePayload(event.payload, { eventType: event.event_type })}
                  </p>

                  <details className="mt-3 rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                      Supporting detail and raw payload
                    </summary>
                    <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <div>
                        <dt className="uppercase tracking-[0.18em]">Event type</dt>
                        <dd className="mt-1 break-all">{event.event_type}</dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-[0.18em]">Event ID</dt>
                        <dd className="mt-1 break-all font-mono">{event.event_id}</dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-[0.18em]">Produced by execution</dt>
                        <dd className="mt-1 break-all">
                          {event.produced_by_execution_id || "Unavailable"}
                        </dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-[0.18em]">Ingested</dt>
                        <dd className="mt-1">{formatDateTime(event.ingested_at)}</dd>
                      </div>
                    </dl>
                    <pre className="mt-3 overflow-x-auto rounded-xl bg-background p-3 text-xs text-muted-foreground">
                      {serializeMessage(event.payload)}
                    </pre>
                  </details>
                </article>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
