import type {
  RootCauseEvidenceResponse,
  RootCauseRunResponse,
} from "@/lib/backend-root-cause";
import { buildViewModelMeta, type ViewModelMeta } from "@/lib/adapters/common";

export type RootCauseRunViewModel = {
  run_id: string;
  cohort_size: number;
  positive_count: number;
  baseline_rate: number;
  insight_count: number;
  warnings: string[];
  interpretation_caveat: string;
  meta: ViewModelMeta;
};

export type RootCauseEvidenceViewModel = {
  handle: string;
  insight_id: string;
  matched_anchor_count: number;
  matched_positive_count: number;
  trace_count: number;
  truncated: boolean;
  meta: ViewModelMeta;
};

export function adaptRootCauseRun(dto: RootCauseRunResponse): RootCauseRunViewModel {
  return {
    run_id: dto.run_id,
    cohort_size: dto.cohort_size,
    positive_count: dto.positive_count,
    baseline_rate: dto.baseline_rate,
    insight_count: dto.insights.length,
    warnings: dto.warnings,
    interpretation_caveat: dto.interpretation_caveat,
    meta: buildViewModelMeta(),
  };
}

export function adaptRootCauseEvidence(
  dto: RootCauseEvidenceResponse
): RootCauseEvidenceViewModel {
  return {
    handle: dto.handle,
    insight_id: dto.insight_id,
    matched_anchor_count: dto.matched_anchor_count,
    matched_positive_count: dto.matched_positive_count,
    trace_count: dto.traces.length,
    truncated: dto.truncated,
    meta: buildViewModelMeta(),
  };
}
