import { asObject, getApiUrl, parseSseEvent, readErrorDetail } from '@/app/lib/api/ai-sse';

export type AssistantCompletionRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AssistantCompletionMessage {
  role: AssistantCompletionRole;
  content?: unknown;
  tool_calls?: Array<Record<string, unknown>>;
  tool_call_id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface AssistantChatContext {
  route?: string;
  module?: string;
  anchor_object_type?: string;
  start_at?: string;
  end_at?: string;
  concept_uris?: string[];
}

export interface AssistantChatRequest {
  completion_messages: AssistantCompletionMessage[];
  context?: AssistantChatContext;
  thread_id?: string;
}

export interface AssistantChatEvidenceItem {
  label: string;
  detail: string;
  uri?: string | null;
}

export interface AssistantChatResponse {
  module: 'assistant';
  task: 'chat';
  response_policy: 'informational' | 'analytical';
  tool_permissions: string[];
  summary: string;
  answer: string;
  evidence: AssistantChatEvidenceItem[];
  caveats: string[];
  next_actions: string[];
  thread_id: string;
  completion_messages: AssistantCompletionMessage[];
}

export interface AssistantChatMetaEvent {
  thread_id: string;
  module: 'assistant';
  task: 'chat';
  response_policy: 'informational' | 'analytical';
  tool_permissions: string[];
}

export interface AssistantChatDeltaEvent {
  text: string;
}

export interface AssistantChatToolStatusEvent {
  status?: string;
  tool?: string;
  call_id?: string;
  summary?: string;
  query_preview?: string | null;
  query_type?: string | null;
  row_count?: number | null;
  truncated?: boolean | null;
  error?: string | null;
  [key: string]: unknown;
}

export interface AssistantChatDoneEvent {
  status?: string;
  [key: string]: unknown;
}

export interface AssistantChatErrorEvent {
  status_code?: number;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

export interface AssistantChatStreamHandlers {
  onMeta?: (payload: AssistantChatMetaEvent) => void;
  onAssistantDelta?: (payload: AssistantChatDeltaEvent) => void;
  onToolStatus?: (payload: AssistantChatToolStatusEvent) => void;
  onFinal?: (payload: AssistantChatResponse) => void;
  onDone?: (payload: AssistantChatDoneEvent) => void;
  onError?: (payload: AssistantChatErrorEvent) => void;
}

export interface AssistantChatStreamResult {
  meta: AssistantChatMetaEvent | null;
  final: AssistantChatResponse | null;
  deltaText: string;
  sawDone: boolean;
}

function handleSseEvent(
  event: string,
  payload: unknown,
  handlers: AssistantChatStreamHandlers,
  result: AssistantChatStreamResult
): void {
  const data = asObject(payload);
  switch (event) {
    case 'meta': {
      const eventPayload = data as unknown as AssistantChatMetaEvent;
      result.meta = eventPayload;
      handlers.onMeta?.(eventPayload);
      return;
    }
    case 'assistant_delta': {
      const text = typeof data.text === 'string' ? data.text : '';
      const eventPayload: AssistantChatDeltaEvent = { text };
      result.deltaText += text;
      handlers.onAssistantDelta?.(eventPayload);
      return;
    }
    case 'tool_status': {
      handlers.onToolStatus?.(data as unknown as AssistantChatToolStatusEvent);
      return;
    }
    case 'final': {
      const eventPayload = data as unknown as AssistantChatResponse;
      result.final = eventPayload;
      handlers.onFinal?.(eventPayload);
      return;
    }
    case 'done': {
      const eventPayload = data as unknown as AssistantChatDoneEvent;
      result.sawDone = true;
      handlers.onDone?.(eventPayload);
      return;
    }
    case 'error': {
      const eventPayload = data as unknown as AssistantChatErrorEvent;
      handlers.onError?.(eventPayload);
      const detail =
        typeof eventPayload.message === 'string' && eventPayload.message.trim().length > 0
          ? eventPayload.message
          : 'Assistant stream failed';
      throw new Error(detail);
    }
    default:
      return;
  }
}

export async function postAssistantChatStream(
  request: AssistantChatRequest,
  handlers: AssistantChatStreamHandlers = {},
  signal?: AbortSignal
): Promise<AssistantChatStreamResult> {
  const response = await fetch(getApiUrl('/ai/assistant/chat'), {
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
  const result: AssistantChatStreamResult = {
    meta: null,
    final: null,
    deltaText: '',
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
