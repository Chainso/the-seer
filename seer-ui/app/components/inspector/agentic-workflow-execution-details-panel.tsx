"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Clock3, RadioTower, Rows3, Waypoints } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  getAgenticWorkflowExecution,
  listAgenticWorkflowMessages,
  streamAgenticWorkflowMessages,
} from "@/app/lib/api/agentic-workflows";
import type {
  AgenticWorkflowActionSummary,
  AgenticWorkflowExecutionDetailResponse,
  AgenticWorkflowStatus,
  AgenticWorkflowTranscriptMessage,
  AgenticWorkflowTranscriptSnapshotEvent,
} from "@/app/types/agentic-workflows";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Table } from "../ui/table";

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

function mergeMessages(
  existing: AgenticWorkflowTranscriptMessage[],
  incoming: AgenticWorkflowTranscriptMessage[]
): AgenticWorkflowTranscriptMessage[] {
  const merged = new Map<number, AgenticWorkflowTranscriptMessage>();
  existing.forEach((message) => merged.set(message.ordinal, message));
  incoming.forEach((message) => merged.set(message.ordinal, message));
  return [...merged.values()].sort((left, right) => left.ordinal - right.ordinal);
}

function summarizeMessageContent(message: AgenticWorkflowTranscriptMessage): string {
  const content = message.message.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content;
  }
  if (Array.isArray(message.message.tool_calls) && message.message.tool_calls.length > 0) {
    return `${message.message.tool_calls.length} tool call(s)`;
  }
  if (typeof message.message.name === "string" && message.message.name.trim().length > 0) {
    return `Tool result from ${message.message.name}`;
  }
  return "Structured message payload";
}

function serializeMessage(message: Record<string, unknown>): string {
  return JSON.stringify(message, null, 2);
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

function ActionTable({
  title,
  emptyLabel,
  actions,
}: {
  title: string;
  emptyLabel: string;
  actions: AgenticWorkflowActionSummary[];
}) {
  return (
    <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        <Waypoints className="h-4 w-4" />
        {title}
      </div>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Action</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Attempts</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Updated</Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {actions.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={4} className="py-8 text-center text-muted-foreground">
                {emptyLabel}
              </Table.Cell>
            </Table.Row>
          ) : (
            actions.map((action) => (
              <Table.Row key={action.action_id}>
                <Table.RowHeaderCell className="max-w-[340px]">
                  <div className="space-y-1">
                    <div className="truncate font-medium">{action.action_uri}</div>
                    <div className="text-xs text-muted-foreground">{action.action_id}</div>
                  </div>
                </Table.RowHeaderCell>
                <Table.Cell>
                  <Badge
                    variant="outline"
                    className={`rounded-full ${statusBadgeClass(action.status)}`}
                  >
                    {action.status}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  {action.attempt_count} / {action.max_attempts}
                </Table.Cell>
                <Table.Cell>{formatDateTime(action.updated_at)}</Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table.Root>
    </Card>
  );
}

export function AgenticWorkflowExecutionDetailsPanel({
  executionId,
}: {
  executionId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = searchParams.get("user_id")?.trim() || "";

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

  const backHref = useMemo(() => {
    if (!userId) {
      return "/inspector/agentic-workflows";
    }
    return `/inspector/agentic-workflows?user_id=${encodeURIComponent(userId)}`;
  }, [userId]);

  const currentStatus = detail?.execution.action.status || snapshot?.status;
  const lastOrdinal = snapshot?.last_ordinal || messages[messages.length - 1]?.ordinal || 0;
  const loading = !detail && !error;

  if (loading) {
    return (
      <Card className="rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground">
        Loading workflow execution...
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

  return (
    <div className="space-y-6" data-agentic-workflow-execution-details-panel>
      <Card className="rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Agentic Workflow Execution
            </p>
            <h1 className="font-display text-3xl">Transcript + Execution Lineage</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              This detail surface reads from persisted transcript messages, generic child
              executions, and explicit produced-event provenance.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className={`rounded-full ${statusBadgeClass(detail.execution.action.status)}`}
              >
                {currentStatus || detail.execution.action.status}
              </Badge>
              <Badge variant="outline" className="rounded-full max-w-[820px] truncate">
                {detail.execution.action.action_uri}
              </Badge>
              <Badge variant="outline" className="rounded-full">
                {messages.length} loaded messages
              </Badge>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => router.push(backHref)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Executions
          </Button>
        </div>
      </Card>

      {streamError && (
        <Card className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {streamError}
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <Rows3 className="h-4 w-4" />
              Persisted Transcript
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
            <div className="space-y-4">
              {messages.map((message) => (
                <Card
                  key={message.ordinal}
                  className="rounded-2xl border border-border bg-muted/10 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-full uppercase">
                      {message.role}
                    </Badge>
                    <Badge variant="outline" className="rounded-full">
                      attempt {message.attempt_no}
                    </Badge>
                    <Badge variant="outline" className="rounded-full">
                      seq {message.sequence_no}
                    </Badge>
                    <Badge variant="outline" className="rounded-full">
                      ordinal {message.ordinal}
                    </Badge>
                    {message.message_kind && (
                      <Badge variant="outline" className="rounded-full">
                        {message.message_kind}
                      </Badge>
                    )}
                    {message.call_id && (
                      <Badge variant="outline" className="rounded-full">
                        {message.call_id}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-3 text-sm">{summarizeMessageContent(message)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Persisted {formatDateTime(message.persisted_at)}
                  </p>
                  <pre className="mt-3 overflow-x-auto rounded-xl bg-background p-3 text-xs text-muted-foreground">
                    {serializeMessage(message.message)}
                  </pre>
                </Card>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <RadioTower className="h-4 w-4" />
              Execution Summary
            </div>
            <dl className="grid gap-4 text-sm md:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Execution ID
                </dt>
                <dd className="mt-1 break-all font-mono text-xs">{detail.execution.action.action_id}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  User ID
                </dt>
                <dd className="mt-1">{detail.execution.action.user_id}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Submitted
                </dt>
                <dd className="mt-1">{formatDateTime(detail.execution.action.submitted_at)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Updated
                </dt>
                <dd className="mt-1">{formatDateTime(detail.execution.action.updated_at)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Completed
                </dt>
                <dd className="mt-1">{formatDateTime(detail.execution.action.completed_at)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Attempts
                </dt>
                <dd className="mt-1">
                  {detail.execution.action.attempt_count} / {detail.execution.action.max_attempts}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Transcript Count
                </dt>
                <dd className="mt-1">{detail.execution.transcript_message_count}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Last Persisted Message
                </dt>
                <dd className="mt-1">
                  {formatDateTime(detail.execution.last_transcript_persisted_at)}
                </dd>
              </div>
            </dl>
          </Card>

          <ActionTable
            title="Child Actions"
            emptyLabel="This execution has not launched any child ontology actions yet."
            actions={detail.child_executions}
          />

          {detail.parent_execution && (
            <ActionTable
              title="Parent Execution"
              emptyLabel="Parent execution unavailable."
              actions={[detail.parent_execution]}
            />
          )}

          <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <Clock3 className="h-4 w-4" />
              Produced Events
            </div>
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Event Type</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Produced By</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Occurred</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {detail.produced_events.length === 0 ? (
                  <Table.Row>
                    <Table.Cell colSpan={3} className="py-8 text-center text-muted-foreground">
                      No produced events recorded for this execution chain yet.
                    </Table.Cell>
                  </Table.Row>
                ) : (
                  detail.produced_events.map((event) => (
                    <Table.Row key={event.event_id}>
                      <Table.RowHeaderCell className="max-w-[320px]">
                        <div className="space-y-1">
                          <div className="truncate font-medium">{event.event_type}</div>
                          <div className="text-xs text-muted-foreground">{event.event_id}</div>
                        </div>
                      </Table.RowHeaderCell>
                      <Table.Cell className="font-mono text-xs">
                        {event.produced_by_execution_id || "-"}
                      </Table.Cell>
                      <Table.Cell>{formatDateTime(event.occurred_at)}</Table.Cell>
                    </Table.Row>
                  ))
                )}
              </Table.Body>
            </Table.Root>
          </Card>
        </div>
      </div>
    </div>
  );
}
