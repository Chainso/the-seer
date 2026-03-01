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

interface ParsedSseEvent {
  event: string;
  payload: unknown;
}

function normalizeApiBase(rawBase: string): string {
  const trimmed = rawBase.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return 'http://localhost:8000/api/v1';
  }

  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    if (!normalizedPath || normalizedPath === '/') {
      parsed.pathname = '/api/v1';
    } else if (normalizedPath === '/api') {
      parsed.pathname = '/api/v1';
    } else if (normalizedPath === '/api/v1') {
      parsed.pathname = '/api/v1';
    } else {
      parsed.pathname = normalizedPath;
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    if (trimmed.endsWith('/api')) {
      return `${trimmed}/v1`;
    }
    return trimmed;
  }
}

const API_BASE = normalizeApiBase(
  process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:8000/api/v1'
);

function getApiUrl(endpoint: string): string {
  return `${API_BASE}${endpoint}`;
}

function asObject(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  return payload as Record<string, unknown>;
}

function readErrorDetail(payload: unknown): string {
  const data = asObject(payload);
  if (typeof data.detail === 'string' && data.detail.trim().length > 0) {
    return data.detail;
  }
  return '';
}

function parseSseEvent(rawEvent: string): ParsedSseEvent | null {
  let eventName = '';
  const dataLines: string[] = [];

  for (const line of rawEvent.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      const data = line.slice(5);
      dataLines.push(data.startsWith(' ') ? data.slice(1) : data);
    }
  }

  if (!eventName) return null;

  const payloadText = dataLines.join('\n');
  let payload: unknown = {};
  if (payloadText.trim().length > 0) {
    try {
      payload = JSON.parse(payloadText);
    } catch {
      throw new Error(`Assistant stream event "${eventName}" had invalid JSON payload`);
    }
  }

  return { event: eventName, payload };
}

function handleSseEvent(
  parsed: ParsedSseEvent,
  handlers: AssistantChatStreamHandlers,
  result: AssistantChatStreamResult
): void {
  const payload = asObject(parsed.payload);
  switch (parsed.event) {
    case 'meta': {
      const eventPayload = payload as AssistantChatMetaEvent;
      result.meta = eventPayload;
      handlers.onMeta?.(eventPayload);
      return;
    }
    case 'assistant_delta': {
      const text = typeof payload.text === 'string' ? payload.text : '';
      const eventPayload: AssistantChatDeltaEvent = { text };
      result.deltaText += text;
      handlers.onAssistantDelta?.(eventPayload);
      return;
    }
    case 'tool_status': {
      handlers.onToolStatus?.(payload as AssistantChatToolStatusEvent);
      return;
    }
    case 'final': {
      const eventPayload = payload as AssistantChatResponse;
      result.final = eventPayload;
      handlers.onFinal?.(eventPayload);
      return;
    }
    case 'done': {
      const eventPayload = payload as AssistantChatDoneEvent;
      result.sawDone = true;
      handlers.onDone?.(eventPayload);
      return;
    }
    case 'error': {
      const eventPayload = payload as AssistantChatErrorEvent;
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
        handleSseEvent(parsed, handlers, result);
      }
      separatorIndex = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  buffer = buffer.replace(/\r/g, '');
  if (buffer.trim().length > 0) {
    const parsed = parseSseEvent(buffer);
    if (parsed) {
      handleSseEvent(parsed, handlers, result);
    }
  }

  return result;
}
