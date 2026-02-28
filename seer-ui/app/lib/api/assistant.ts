import { postAssistantChat } from "./assistant-chat";
import type {
  AssistantConversationRole,
  AssistantMode,
  AssistantEvidenceRef,
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
  const response = await postAssistantChat({
    messages: [
      ...(request.conversation || []),
      { role: "user", content: request.prompt },
    ],
    context: {
      module: request.mode,
      concept_uris: request.contextConceptUris,
    },
  });

  const evidence: AssistantEvidenceRef[] =
    response.evidence.length > 0
      ? response.evidence.map((item, index) => ({
          label: item.label,
          conceptUri: item.uri || `urn:seer:assistant:evidence:${index + 1}`,
          source: item.detail,
        }))
      : [
          {
            label: "Assistant summary",
            conceptUri: "urn:seer:assistant:evidence:summary",
            source: response.summary,
          },
        ];

  const bullets =
    response.evidence.length > 0
      ? response.evidence.slice(0, 3).map((item) => `${item.label}: ${item.detail}`)
      : [
          response.caveats[0] ||
            "No direct ontology evidence returned for this turn.",
        ];

  const nextActions =
    response.next_actions.length > 0
      ? response.next_actions
      : ["Ask a narrower follow-up question to increase evidence coverage."];

  const uncertainty =
    response.caveats[0] ||
    "This response should be validated against ontology and trace evidence.";

  return {
    mode: request.mode,
    modePayload: {
      title: `Assistant ${request.mode.toUpperCase()}`,
      bullets,
    },
    answer: response.answer,
    nextActions,
    evidence,
    confidence: response.evidence.length > 0 ? 0.82 : 0.66,
    uncertainty,
  };
}
