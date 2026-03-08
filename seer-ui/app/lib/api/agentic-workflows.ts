import { fetchApi } from './client';
import { asObject, getApiUrl, parseSseEvent, readErrorDetail } from '@/app/lib/api/ai-sse';
import { queryOntologySelect } from '@/app/lib/api/ontology';
import type {
  AgenticWorkflowCapabilityOption,
  AgenticWorkflowExecutionDetailResponse,
  AgenticWorkflowExecutionListResponse,
  AgenticWorkflowMessagesResponse,
  AgenticWorkflowStatus,
  AgenticWorkflowTranscriptErrorEvent,
  AgenticWorkflowTranscriptMessage,
  AgenticWorkflowTranscriptSnapshotEvent,
} from '@/app/types/agentic-workflows';

const REGISTERED_AGENTIC_WORKFLOW_QUERY = `
PREFIX prophet: <http://prophet.platform/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX seer: <http://seer.platform/ontology#>
SELECT DISTINCT ?workflow ?label
WHERE {
  ?workflow a ?workflowType .
  ?workflowType rdfs:subClassOf* seer:AgenticWorkflow .
  FILTER(isIRI(?workflow))
  OPTIONAL { ?workflow prophet:name ?prophetName . }
  OPTIONAL { ?workflow rdfs:label ?rdfsLabel . }
  BIND(COALESCE(STR(?prophetName), STR(?rdfsLabel), STR(?workflow)) AS ?label)
}
`.trim();

export async function listAgenticWorkflowExecutions(options: {
  userId?: string;
  status?: AgenticWorkflowStatus;
  workflowUri?: string;
  search?: string;
  page?: number;
  size?: number;
  submittedAfter?: string;
  submittedBefore?: string;
}): Promise<AgenticWorkflowExecutionListResponse> {
  const query = new URLSearchParams();
  if (options.userId?.trim()) {
    query.set('user_id', options.userId.trim());
  }
  if (options.status) {
    query.set('status', options.status);
  }
  if (options.workflowUri?.trim()) {
    query.set('workflow_uri', options.workflowUri.trim());
  }
  if (options.search?.trim()) {
    query.set('search', options.search.trim());
  }
  query.set('page', String(options.page ?? 1));
  query.set('size', String(options.size ?? 20));
  if (options.submittedAfter) {
    query.set('submitted_after', options.submittedAfter);
  }
  if (options.submittedBefore) {
    query.set('submitted_before', options.submittedBefore);
  }
  return fetchApi<AgenticWorkflowExecutionListResponse>(
    `/agentic-workflows/executions?${query.toString()}`
  );
}

export async function listRegisteredAgenticWorkflows(): Promise<
  AgenticWorkflowCapabilityOption[]
> {
  const rows = await queryOntologySelect(REGISTERED_AGENTIC_WORKFLOW_QUERY);
  const options = new Map<string, AgenticWorkflowCapabilityOption>();
  rows.forEach((row) => {
    const value = row.workflow?.trim();
    if (!value || options.has(value)) {
      return;
    }
    options.set(value, {
      value,
      label: row.label?.trim() || value,
    });
  });
  return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label));
}

export async function getAgenticWorkflowExecution(
  executionId: string
): Promise<AgenticWorkflowExecutionDetailResponse> {
  return fetchApi<AgenticWorkflowExecutionDetailResponse>(
    `/agentic-workflows/executions/${executionId}`
  );
}

export async function listAgenticWorkflowMessages(options: {
  executionId: string;
  afterOrdinal?: number;
  limit?: number;
}): Promise<AgenticWorkflowMessagesResponse> {
  const query = new URLSearchParams();
  query.set('after_ordinal', String(options.afterOrdinal ?? 0));
  query.set('limit', String(options.limit ?? 200));
  return fetchApi<AgenticWorkflowMessagesResponse>(
    `/agentic-workflows/executions/${options.executionId}/messages?${query.toString()}`
  );
}

export interface AgenticWorkflowMessageStreamHandlers {
  onSnapshot?: (payload: AgenticWorkflowTranscriptSnapshotEvent) => void;
  onMessage?: (payload: AgenticWorkflowTranscriptMessage) => void;
  onTerminal?: (payload: AgenticWorkflowTranscriptSnapshotEvent) => void;
  onError?: (payload: AgenticWorkflowTranscriptErrorEvent) => void;
}

export interface AgenticWorkflowMessageStreamResult {
  snapshot: AgenticWorkflowTranscriptSnapshotEvent | null;
  lastOrdinal: number;
  terminal: AgenticWorkflowTranscriptSnapshotEvent | null;
}

export async function streamAgenticWorkflowMessages(
  options: {
    executionId: string;
    afterOrdinal?: number;
    pollIntervalMs?: number;
    limit?: number;
  },
  handlers: AgenticWorkflowMessageStreamHandlers = {},
  signal?: AbortSignal
): Promise<AgenticWorkflowMessageStreamResult> {
  const query = new URLSearchParams();
  query.set('after_ordinal', String(options.afterOrdinal ?? 0));
  query.set('poll_interval_ms', String(options.pollIntervalMs ?? 500));
  query.set('limit', String(options.limit ?? 200));

  const response = await fetch(
    getApiUrl(
      `/agentic-workflows/executions/${options.executionId}/messages/stream?${query.toString()}`
    ),
    {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
      },
      signal,
    }
  );

  if (!response.ok) {
    let detail = '';
    try {
      detail = readErrorDetail(await response.json());
    } catch {
      detail = '';
    }
    const suffix = detail ? `: ${detail}` : '';
    throw new Error(`API error: ${response.status} ${response.statusText}${suffix}`);
  }

  if (!response.body) {
    throw new Error('API error: empty response stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const result: AgenticWorkflowMessageStreamResult = {
    snapshot: null,
    lastOrdinal: options.afterOrdinal ?? 0,
    terminal: null,
  };

  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r/g, '');

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex >= 0) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const parsed = parseSseEvent(rawEvent);
      if (parsed) {
        _handleEvent(parsed.event, parsed.payload, handlers, result);
      }
      separatorIndex = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  buffer = buffer.replace(/\r/g, '');
  if (buffer.trim().length > 0) {
    const parsed = parseSseEvent(buffer);
    if (parsed) {
      _handleEvent(parsed.event, parsed.payload, handlers, result);
    }
  }

  return result;
}

function _handleEvent(
  event: string,
  payload: unknown,
  handlers: AgenticWorkflowMessageStreamHandlers,
  result: AgenticWorkflowMessageStreamResult
): void {
  const data = asObject(payload);
  switch (event) {
    case 'snapshot': {
      const snapshot = data as unknown as AgenticWorkflowTranscriptSnapshotEvent;
      result.snapshot = snapshot;
      result.lastOrdinal = snapshot.last_ordinal;
      handlers.onSnapshot?.(snapshot);
      return;
    }
    case 'message': {
      const message = data as unknown as AgenticWorkflowTranscriptMessage;
      result.lastOrdinal = Math.max(result.lastOrdinal, message.ordinal);
      handlers.onMessage?.(message);
      return;
    }
    case 'terminal': {
      const terminal = data as unknown as AgenticWorkflowTranscriptSnapshotEvent;
      result.terminal = terminal;
      result.lastOrdinal = terminal.last_ordinal;
      handlers.onTerminal?.(terminal);
      return;
    }
    case 'error': {
      const eventPayload = data as unknown as AgenticWorkflowTranscriptErrorEvent;
      handlers.onError?.(eventPayload);
      const detail =
        typeof eventPayload.message === 'string' && eventPayload.message.trim().length > 0
          ? eventPayload.message
          : 'Agentic workflow transcript stream failed';
      throw new Error(detail);
    }
    default:
      return;
  }
}
