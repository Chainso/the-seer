import type { AiAssistEnvelope } from "@/lib/backend-ai";
import { buildViewModelMeta, type ViewModelMeta } from "@/lib/adapters/common";

export type AiAssistPanelViewModel = {
  module: AiAssistEnvelope["module"];
  task: string;
  summary: string;
  evidence_count: number;
  caveat_count: number;
  next_action_count: number;
  response_policy: AiAssistEnvelope["response_policy"];
  meta: ViewModelMeta;
};

export function adaptAiAssistEnvelope(dto: AiAssistEnvelope): AiAssistPanelViewModel {
  return {
    module: dto.module,
    task: dto.task,
    summary: dto.summary,
    evidence_count: dto.evidence.length,
    caveat_count: dto.caveats.length,
    next_action_count: dto.next_actions.length,
    response_policy: dto.response_policy,
    meta: buildViewModelMeta(),
  };
}
