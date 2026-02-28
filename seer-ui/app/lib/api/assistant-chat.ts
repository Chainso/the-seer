import { fetchApi } from './client';

export type AssistantChatRole = 'user' | 'assistant';

export interface AssistantChatMessage {
  role: AssistantChatRole;
  content: string;
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
