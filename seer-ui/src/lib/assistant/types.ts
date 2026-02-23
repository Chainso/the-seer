import type { AiEvidenceItem } from "@/lib/backend-ai";

export type AssistantMessageRole = "user" | "assistant";

export type AssistantMessage<TPayload = unknown> = {
  id: string;
  role: AssistantMessageRole;
  content: string;
  at: string;
  payload?: TPayload;
};

export type AssistantThread<TPayload = unknown> = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AssistantMessage<TPayload>[];
};

export type AssistantPanelContent = {
  summary: string;
  evidence: AiEvidenceItem[];
  caveats: string[];
  nextActions: string[];
};

export type GuidedShortcutSource = "ontology" | "process" | "root-cause";

export type GuidedInvestigationShortcutInput = {
  source: GuidedShortcutSource;
  question: string;
  anchorObjectType: string;
  startAt: string;
  endAt: string;
  depth?: number;
  outcomeEventType?: string;
};

export type GuidedInvestigationShortcutLink = {
  id: string;
  label: string;
  description: string;
  href: string;
  source: GuidedShortcutSource;
};
