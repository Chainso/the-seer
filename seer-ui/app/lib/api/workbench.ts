import type { AssistantChatContext } from '@/app/lib/api/assistant-chat';
import { asObject, getApiUrl, parseSseEvent, readErrorDetail } from '@/app/lib/api/ai-sse';

export interface WorkbenchChatRequest {
  question: string;
  context?: AssistantChatContext;
  thread_id?: string;
  investigation_id?: string;
  depth?: number;
  outcome_event_type?: string;
}

export interface WorkbenchLinkedSurface {
  kind: 'ontology' | 'history' | 'process' | 'root_cause' | 'action_status';
  label: string;
  href: string;
  reason: string;
}

export interface WorkbenchClarifyingQuestion {
  field: 'anchor_object_type' | 'time_window';
  prompt: string;
}

export interface WorkbenchChatResponse {
  module: 'workbench';
  task: 'chat';
  response_policy: 'informational' | 'analytical';
  tool_permissions: string[];
  summary: string;
  evidence: Array<{ label: string; detail: string; uri?: string | null }>;
  caveats: string[];
  next_actions: string[];
  thread_id: string;
  investigation_id: string;
  turn_kind: 'investigation_answer' | 'clarifying_question';
  answer_markdown: string;
  why_it_matters: string;
  follow_up_questions: string[];
  linked_surfaces: WorkbenchLinkedSurface[];
  clarifying_questions: WorkbenchClarifyingQuestion[];
  anchor_object_type?: string | null;
  start_at?: string | null;
  end_at?: string | null;
}

export interface WorkbenchChatMetaEvent {
  thread_id: string;
  investigation_id: string;
  module: 'workbench';
  task: 'chat';
  turn_kind: 'investigation_answer' | 'clarifying_question';
  response_policy: 'informational' | 'analytical';
  tool_permissions: string[];
}

export interface WorkbenchChatDeltaEvent {
  text: string;
}

export interface WorkbenchInvestigationStatusEvent {
  status: string;
  message: string;
}

export type WorkbenchLinkedSurfaceHintEvent = WorkbenchLinkedSurface;

export interface WorkbenchChatDoneEvent {
  status?: string;
  [key: string]: unknown;
}

export interface WorkbenchChatErrorEvent {
  status_code?: number;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

export interface WorkbenchChatStreamHandlers {
  onMeta?: (payload: WorkbenchChatMetaEvent) => void;
  onAssistantDelta?: (payload: WorkbenchChatDeltaEvent) => void;
  onInvestigationStatus?: (payload: WorkbenchInvestigationStatusEvent) => void;
  onLinkedSurfaceHint?: (payload: WorkbenchLinkedSurfaceHintEvent) => void;
  onFinal?: (payload: WorkbenchChatResponse) => void;
  onDone?: (payload: WorkbenchChatDoneEvent) => void;
  onError?: (payload: WorkbenchChatErrorEvent) => void;
}

export interface WorkbenchChatStreamResult {
  meta: WorkbenchChatMetaEvent | null;
  final: WorkbenchChatResponse | null;
  deltaText: string;
  statuses: WorkbenchInvestigationStatusEvent[];
  linkedSurfaceHints: WorkbenchLinkedSurfaceHintEvent[];
  sawDone: boolean;
}

function handleSseEvent(
  event: string,
  payload: unknown,
  handlers: WorkbenchChatStreamHandlers,
  result: WorkbenchChatStreamResult
): void {
  const data = asObject(payload);
  switch (event) {
    case 'meta': {
      const eventPayload = data as unknown as WorkbenchChatMetaEvent;
      result.meta = eventPayload;
      handlers.onMeta?.(eventPayload);
      return;
    }
    case 'assistant_delta': {
      const text = typeof data.text === 'string' ? data.text : '';
      const eventPayload: WorkbenchChatDeltaEvent = { text };
      result.deltaText += text;
      handlers.onAssistantDelta?.(eventPayload);
      return;
    }
    case 'investigation_status': {
      const eventPayload = data as unknown as WorkbenchInvestigationStatusEvent;
      result.statuses.push(eventPayload);
      handlers.onInvestigationStatus?.(eventPayload);
      return;
    }
    case 'linked_surface_hint': {
      const eventPayload = data as unknown as WorkbenchLinkedSurfaceHintEvent;
      result.linkedSurfaceHints.push(eventPayload);
      handlers.onLinkedSurfaceHint?.(eventPayload);
      return;
    }
    case 'final': {
      const eventPayload = data as unknown as WorkbenchChatResponse;
      result.final = eventPayload;
      handlers.onFinal?.(eventPayload);
      return;
    }
    case 'done': {
      const eventPayload = data as unknown as WorkbenchChatDoneEvent;
      result.sawDone = true;
      handlers.onDone?.(eventPayload);
      return;
    }
    case 'error': {
      const eventPayload = data as unknown as WorkbenchChatErrorEvent;
      handlers.onError?.(eventPayload);
      const detail =
        typeof eventPayload.message === 'string' && eventPayload.message.trim().length > 0
          ? eventPayload.message
          : 'Workbench stream failed';
      throw new Error(detail);
    }
    default:
      return;
  }
}

export async function postWorkbenchChatStream(
  request: WorkbenchChatRequest,
  handlers: WorkbenchChatStreamHandlers = {},
  signal?: AbortSignal
): Promise<WorkbenchChatStreamResult> {
  const response = await fetch(getApiUrl('/ai/workbench/chat'), {
    method: 'POST',
    body: JSON.stringify(request),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    signal,
  });

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
  const result: WorkbenchChatStreamResult = {
    meta: null,
    final: null,
    deltaText: '',
    statuses: [],
    linkedSurfaceHints: [],
    sawDone: false,
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
        handleSseEvent(parsed.event, parsed.payload, handlers, result);
      }
      separatorIndex = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  buffer = buffer.replace(/\r/g, '');
  if (buffer.trim().length > 0) {
    const parsed = parseSseEvent(buffer);
    if (parsed) {
      handleSseEvent(parsed.event, parsed.payload, handlers, result);
    }
  }

  return result;
}
