import type { GuidedInvestigationResponse } from "@/lib/backend-ai";
import { buildViewModelMeta, type ViewModelMeta } from "@/lib/adapters/common";

export type GuidedInvestigationViewModel = {
  investigation_id: string;
  window_label: string;
  ontology_summary: string;
  process_run_id: string;
  root_cause_run_id: string;
  insight_count: number;
  meta: ViewModelMeta;
};

export function adaptGuidedInvestigation(
  dto: GuidedInvestigationResponse
): GuidedInvestigationViewModel {
  return {
    investigation_id: dto.investigation_id,
    window_label: `${dto.start_at} to ${dto.end_at}`,
    ontology_summary: dto.ontology.summary,
    process_run_id: dto.process_run.run_id,
    root_cause_run_id: dto.root_cause_run.run_id,
    insight_count: dto.root_cause_run.insights.length,
    meta: buildViewModelMeta(),
  };
}
