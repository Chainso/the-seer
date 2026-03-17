import { fetchApi } from './client';
import { asObject, getApiUrl, parseSseEvent, readErrorDetail } from '@/app/lib/api/ai-sse';
import { queryOntologySelect } from '@/app/lib/api/ontology';
import type {
  AgenticWorkflowCapabilityOption,
  AgenticWorkflowExecutionDetailResponse,
  AgenticWorkflowExecutionListResponse,
  AgenticWorkflowMessagesResponse,
  AgenticWorkflowRetryResponse,
  AgenticWorkflowStatus,
  AgenticWorkflowTranscriptErrorEvent,
  AgenticWorkflowTranscriptMessage,
  AgenticWorkflowTranscriptSnapshotEvent,
  ManagedAgentApiErrorDetail,
  ManagedAgentDetail,
  ManagedAgentEditorCatalog,
  ManagedAgentListResponse,
  ManagedAgentUpsertRequest,
} from '@/app/types/agentic-workflows';

const REGISTERED_AGENTIC_ACTION_QUERY = `
PREFIX prophet: <http://prophet.platform/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX seer: <http://seer.platform/ontology#>
SELECT DISTINCT ?action ?label
WHERE {
  ?action a ?actionType .
  ?actionType rdfs:subClassOf* seer:AgenticWorkflow .
  FILTER(isIRI(?action))
  OPTIONAL { ?action prophet:name ?prophetName . }
  OPTIONAL { ?action rdfs:label ?rdfsLabel . }
  BIND(COALESCE(STR(?prophetName), STR(?rdfsLabel), STR(?action)) AS ?label)
}
`.trim();

export async function listAgenticWorkflowExecutions(options: {
  userId?: string;
  status?: AgenticWorkflowStatus;
  actionUri?: string;
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
  if (options.actionUri?.trim()) {
    query.set('action_uri', options.actionUri.trim());
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

export async function listRegisteredAgenticActions(): Promise<
  AgenticWorkflowCapabilityOption[]
> {
  const rows = await queryOntologySelect(REGISTERED_AGENTIC_ACTION_QUERY);
  const options = new Map<string, AgenticWorkflowCapabilityOption>();
  rows.forEach((row) => {
    const value = row.action?.trim();
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

export interface ManagedAgentRequestError extends Error {
  status: number;
  statusText: string;
  detail: ManagedAgentApiErrorDetail | string | null;
}

async function fetchManagedAgentApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(getApiUrl(endpoint), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    let detail: ManagedAgentApiErrorDetail | string | null = null;

    try {
      const body = await response.json();
      if (body && typeof body === 'object' && 'detail' in body) {
        const candidate = body.detail;
        if (typeof candidate === 'string') {
          detail = candidate;
        } else if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          detail = candidate as ManagedAgentApiErrorDetail;
        }
      }
    } catch {
      detail = null;
    }

    const detailMessage =
      typeof detail === 'string'
        ? detail
        : typeof detail?.message === 'string'
          ? detail.message
          : '';

    const suffix = detailMessage ? `: ${detailMessage}` : '';
    const error = new Error(
      `API error: ${response.status} ${response.statusText}${suffix}`
    ) as ManagedAgentRequestError;
    error.status = response.status;
    error.statusText = response.statusText;
    error.detail = detail;
    throw error;
  }

  return response.json();
}

export async function listManagedAgents(): Promise<ManagedAgentListResponse> {
  return fetchApi<ManagedAgentListResponse>('/agentic-workflows/managed-agents');
}

export async function getManagedAgent(managedAgentKey: string): Promise<ManagedAgentDetail> {
  return fetchApi<ManagedAgentDetail>(`/agentic-workflows/managed-agents/${managedAgentKey}`);
}

export async function getManagedAgentEditorCatalog(): Promise<ManagedAgentEditorCatalog> {
  return fetchApi<ManagedAgentEditorCatalog>('/agentic-workflows/managed-agents/editor-catalog');
}

export async function createManagedAgent(
  payload: ManagedAgentUpsertRequest
): Promise<ManagedAgentDetail> {
  return fetchManagedAgentApi<ManagedAgentDetail>('/agentic-workflows/managed-agents', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateManagedAgent(
  managedAgentKey: string,
  payload: ManagedAgentUpsertRequest
): Promise<ManagedAgentDetail> {
  return fetchManagedAgentApi<ManagedAgentDetail>(
    `/agentic-workflows/managed-agents/${managedAgentKey}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    }
  );
}

export async function getAgenticWorkflowExecution(
  executionId: string
): Promise<AgenticWorkflowExecutionDetailResponse> {
  return fetchApi<AgenticWorkflowExecutionDetailResponse>(
    `/agentic-workflows/executions/${executionId}`
  );
}

export async function retryAgenticWorkflowExecution(
  executionId: string
): Promise<AgenticWorkflowRetryResponse> {
  return fetchManagedAgentApi<AgenticWorkflowRetryResponse>(`/actions/${executionId}/retry`, {
    method: 'POST',
  });
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
          : 'Managed-agent transcript stream failed';
      throw new Error(detail);
    }
    default:
      return;
  }
}
