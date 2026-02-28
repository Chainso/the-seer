export type AssistantMode = "explain" | "review" | "incident" | "optimize";

export type AssistantConversationRole = "user" | "assistant";

export interface AssistantConversationMessage {
  id: string;
  at: string;
  role: AssistantConversationRole;
  content: string;
  mode?: AssistantMode;
  response?: AssistantResponseContract;
}

export interface AssistantConversationThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AssistantConversationMessage[];
}

export interface AssistantEvidenceRef {
  label: string;
  conceptUri: string;
  source: string;
}

export interface AssistantModePayload {
  title: string;
  bullets: string[];
}

export interface AssistantResponseContract {
  mode: AssistantMode;
  modePayload: AssistantModePayload;
  answer: string;
  nextActions: string[];
  evidence: AssistantEvidenceRef[];
  confidence: number;
  uncertainty: string;
}

export type AssistantAuditAction = "generated" | "decision_saved";

export interface AssistantAuditEntry {
  id: string;
  at: string;
  action: AssistantAuditAction;
  mode: AssistantMode;
  prompt: string;
  answer: string;
  evidence: AssistantEvidenceRef[];
  confidence: number;
  uncertainty: string;
  redactionApplied?: boolean;
}
