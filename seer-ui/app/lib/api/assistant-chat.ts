import { fetchApi } from './client';

export type AssistantChatRole = 'user' | 'assistant';
export type AssistantCompletionRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AssistantChatMessage {
  role: AssistantChatRole;
  content: string;
}

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
  messages: AssistantChatMessage[];
  completion_messages?: AssistantCompletionMessage[];
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

export async function postAssistantChat(
  request: AssistantChatRequest,
  signal?: AbortSignal
): Promise<AssistantChatResponse> {
  return fetchApi<AssistantChatResponse>('/ai/assistant/chat', {
    method: 'POST',
    body: JSON.stringify(request),
    signal,
  });
}
