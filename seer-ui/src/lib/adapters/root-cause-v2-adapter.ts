import type {
  InsightResult,
  RootCauseEvidenceResponse,
  RootCauseRunResponse,
} from "@/lib/backend-root-cause";
import { buildViewModelMeta, type ViewModelMeta } from "@/lib/adapters/common";

export type RootCauseInsightViewModel = {
  insight_id: string;
  rank: number;
  title: string;
  condition_label: string;
  wracc: number;
  wracc_label: string;
  lift: number;
  lift_label: string;
  coverage: number;
  coverage_label: string;
  support: number;
  positives: number;
  evidence_handle: string;
  caveat: string;
};

export type RootCauseRunV2ViewModel = {
  run_id: string;
  anchor_object_type: string;
  window_label: string;
  outcome_label: string;
  cohort_size: number;
  positive_count: number;
  baseline_rate: number;
  baseline_rate_label: string;
  feature_count: number;
  warnings: string[];
  interpretation_caveat: string;
  insights: RootCauseInsightViewModel[];
  meta: ViewModelMeta;
};

export type RootCauseEvidenceTraceViewModel = {
  anchor_key: string;
  outcome_label: "positive" | "negative";
  event_flow: string;
  event_count: number;
  occurred_at_start: string | null;
  occurred_at_end: string | null;
};

export type RootCauseEvidenceV2ViewModel = {
  handle: string;
  insight_id: string;
  matched_anchor_count: number;
  matched_positive_count: number;
  positive_rate_label: string;
  trace_count: number;
  truncated: boolean;
  traces: RootCauseEvidenceTraceViewModel[];
  meta: ViewModelMeta;
};

export type RootCauseInsightComparisonViewModel = {
  primary: RootCauseInsightViewModel;
  secondary: RootCauseInsightViewModel;
  lift_delta: number;
  lift_delta_label: string;
  coverage_delta: number;
  coverage_delta_label: string;
  support_delta: number;
  support_delta_label: string;
  leading_insight_id: string;
};

const PERCENT_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPercent(value: number): string {
  return `${PERCENT_FORMATTER.format(value * 100)}%`;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString();
}

function buildConditionLabel(insight: InsightResult): string {
  if (insight.conditions.length === 0) {
    return "No explicit feature conditions";
  }
  return insight.conditions
    .map((condition) => `${condition.feature} ${condition.op} ${condition.value}`)
    .join(" AND ");
}

function adaptInsight(insight: InsightResult): RootCauseInsightViewModel {
  return {
    insight_id: insight.insight_id,
    rank: insight.rank,
    title: insight.title,
    condition_label: buildConditionLabel(insight),
    wracc: insight.score.wracc,
    wracc_label: insight.score.wracc.toFixed(4),
    lift: insight.score.lift,
    lift_label: insight.score.lift.toFixed(2),
    coverage: insight.score.coverage,
    coverage_label: formatPercent(insight.score.coverage),
    support: insight.score.support,
    positives: insight.evidence.matched_positive_count,
    evidence_handle: insight.evidence_handle,
    caveat: insight.caveat,
  };
}

export function adaptRootCauseRunV2(dto: RootCauseRunResponse): RootCauseRunV2ViewModel {
  return {
    run_id: dto.run_id,
    anchor_object_type: dto.anchor_object_type,
    window_label: `${formatDateTime(dto.start_at)} to ${formatDateTime(dto.end_at)}`,
    outcome_label: dto.outcome.object_type
      ? `${dto.outcome.event_type} (${dto.outcome.object_type})`
      : dto.outcome.event_type,
    cohort_size: dto.cohort_size,
    positive_count: dto.positive_count,
    baseline_rate: dto.baseline_rate,
    baseline_rate_label: formatPercent(dto.baseline_rate),
    feature_count: dto.feature_count,
    warnings: dto.warnings,
    interpretation_caveat: dto.interpretation_caveat,
    insights: dto.insights.map(adaptInsight),
    meta: buildViewModelMeta(),
  };
}

export function adaptRootCauseEvidenceV2(
  dto: RootCauseEvidenceResponse
): RootCauseEvidenceV2ViewModel {
  const positiveRate =
    dto.matched_anchor_count > 0 ? dto.matched_positive_count / dto.matched_anchor_count : 0;

  return {
    handle: dto.handle,
    insight_id: dto.insight_id,
    matched_anchor_count: dto.matched_anchor_count,
    matched_positive_count: dto.matched_positive_count,
    positive_rate_label: formatPercent(positiveRate),
    trace_count: dto.traces.length,
    truncated: dto.truncated,
    traces: dto.traces.map((trace) => {
      const firstEvent = trace.events[0]?.occurred_at ?? null;
      const lastEvent = trace.events[trace.events.length - 1]?.occurred_at ?? null;
      return {
        anchor_key: trace.anchor_key,
        outcome_label: trace.outcome ? "positive" : "negative",
        event_flow: trace.events.map((event) => event.event_type).join(" -> "),
        event_count: trace.events.length,
        occurred_at_start: firstEvent,
        occurred_at_end: lastEvent,
      };
    }),
    meta: buildViewModelMeta(),
  };
}

export function selectRootCauseInsightsForComparison(
  insights: InsightResult[],
  selectedInsightIds: string[]
): RootCauseInsightViewModel[] {
  if (selectedInsightIds.length === 0) {
    return [];
  }

  const selected = new Set(selectedInsightIds);
  return insights.filter((insight) => selected.has(insight.insight_id)).map(adaptInsight);
}

export function buildRootCauseInsightComparison(
  insights: InsightResult[],
  primaryInsightId: string,
  secondaryInsightId: string
): RootCauseInsightComparisonViewModel | null {
  const primarySource = insights.find((insight) => insight.insight_id === primaryInsightId);
  const secondarySource = insights.find((insight) => insight.insight_id === secondaryInsightId);

  if (!primarySource || !secondarySource) {
    return null;
  }

  const liftDelta = primarySource.score.lift - secondarySource.score.lift;
  const coverageDelta = primarySource.score.coverage - secondarySource.score.coverage;
  const supportDelta = primarySource.score.support - secondarySource.score.support;

  return {
    primary: adaptInsight(primarySource),
    secondary: adaptInsight(secondarySource),
    lift_delta: liftDelta,
    lift_delta_label: `${liftDelta >= 0 ? "+" : ""}${liftDelta.toFixed(2)}`,
    coverage_delta: coverageDelta,
    coverage_delta_label: `${coverageDelta >= 0 ? "+" : ""}${formatPercent(coverageDelta)}`,
    support_delta: supportDelta,
    support_delta_label: `${supportDelta >= 0 ? "+" : ""}${supportDelta}`,
    leading_insight_id:
      primarySource.score.lift >= secondarySource.score.lift
        ? primarySource.insight_id
        : secondarySource.insight_id,
  };
}
