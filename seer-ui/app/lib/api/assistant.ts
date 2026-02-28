import { fetchApi } from "./client";
import type {
  AssistantConversationRole,
  AssistantMode,
  AssistantResponseContract,
} from "@/app/types/assistant";

export interface AssistantConversationRequestMessage {
  role: AssistantConversationRole;
  content: string;
}

export interface AssistantGenerateRequest {
  mode: AssistantMode;
  prompt: string;
  conversation?: AssistantConversationRequestMessage[];
  contextConceptUris?: string[];
}

export async function generateAssistantBrief(
  request: AssistantGenerateRequest
): Promise<AssistantResponseContract> {
  return fetchApi<AssistantResponseContract>("/assistant/generate", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
