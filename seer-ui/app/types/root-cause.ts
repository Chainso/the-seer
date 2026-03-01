export type RootCauseFilterOperator = "eq" | "ne" | "contains" | "gt" | "gte" | "lt" | "lte";

export interface RootCauseFilterCondition {
  field: string;
  op: RootCauseFilterOperator;
  value: string;
}

export interface RootCauseOutcomeDefinition {
  kind?: "event_type";
  event_type: string;
  object_type?: string | null;
}

export interface RootCauseRequestContract {
  anchor_object_type: string;
  start_at: string;
  end_at: string;
  depth: number;
  outcome: RootCauseOutcomeDefinition;
  filters?: RootCauseFilterCondition[];
  beam_width?: number;
  max_rule_length?: number;
  min_coverage_ratio?: number;
  mi_cardinality_threshold?: number;
  max_insights?: number;
}

export interface RootCauseInsightConditionContract {
  feature: string;
  op: "eq";
  value: string;
}

export interface RootCauseInsightScoreContract {
  wracc: number;
  mutual_information: number | null;
  coverage: number;
  support: number;
  positives: number;
  subgroup_rate: number;
  baseline_rate: number;
  lift: number;
}

export interface RootCauseInsightEvidenceSummaryContract {
  matched_anchor_count: number;
  matched_positive_count: number;
  sample_anchor_keys: string[];
  top_event_types: string[];
}

export interface RootCauseInsightResultContract {
  insight_id: string;
  rank: number;
  title: string;
  conditions: RootCauseInsightConditionContract[];
  score: RootCauseInsightScoreContract;
  evidence_handle: string;
  evidence: RootCauseInsightEvidenceSummaryContract;
  caveat: string;
}

export interface RootCauseRunResponseContract {
  run_id: string;
  anchor_object_type: string;
  start_at: string;
  end_at: string;
  depth: number;
  outcome: RootCauseOutcomeDefinition;
  cohort_size: number;
  positive_count: number;
  baseline_rate: number;
  feature_count: number;
  insights: RootCauseInsightResultContract[];
  warnings: string[];
  interpretation_caveat: string;
}

export interface RootCauseEvidenceEventContract {
  event_id: string;
  occurred_at: string;
  event_type: string;
  object_instances: string[];
}

export interface RootCauseEvidenceTraceContract {
  anchor_key: string;
  anchor_object_type: string;
  anchor_object_ref_hash: number;
  anchor_object_ref_canonical: string;
  outcome: boolean;
  events: RootCauseEvidenceEventContract[];
}

export interface RootCauseEvidenceResponseContract {
  handle: string;
  insight_id: string;
  matched_anchor_count: number;
  matched_positive_count: number;
  traces: RootCauseEvidenceTraceContract[];
  truncated: boolean;
}

export interface RootCauseAssistSetupRequestContract {
  anchor_object_type: string;
  start_at: string;
  end_at: string;
}

export interface RootCauseSetupSuggestionContract {
  outcome: RootCauseOutcomeDefinition;
  rationale: string;
}

export interface RootCauseAssistSetupResponseContract {
  suggested_depth: number;
  suggestions: RootCauseSetupSuggestionContract[];
  notes: string[];
}

export interface RootCauseAssistInterpretRequestContract {
  baseline_rate: number;
  insights: RootCauseInsightResultContract[];
}

export interface RootCauseAssistInterpretResponseContract {
  summary: string;
  caveats: string[];
  next_steps: string[];
}
