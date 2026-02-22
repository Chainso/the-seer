export type OutcomeDefinition = {
  kind?: "event_type";
  event_type: string;
  object_type?: string | null;
};

export type RcaFilterCondition = {
  field: string;
  op: "eq" | "ne" | "contains";
  value: string;
};

export type RootCauseRequest = {
  anchor_object_type: string;
  start_at: string;
  end_at: string;
  depth: number;
  outcome: OutcomeDefinition;
  filters?: RcaFilterCondition[];
  beam_width?: number;
  max_rule_length?: number;
  min_coverage_ratio?: number;
  mi_cardinality_threshold?: number;
  max_insights?: number;
};

export type InsightCondition = {
  feature: string;
  op: "eq";
  value: string;
};

export type InsightScore = {
  wracc: number;
  mutual_information: number | null;
  coverage: number;
  support: number;
  positives: number;
  subgroup_rate: number;
  baseline_rate: number;
  lift: number;
};

export type InsightResult = {
  insight_id: string;
  rank: number;
  title: string;
  conditions: InsightCondition[];
  score: InsightScore;
  evidence_handle: string;
  evidence: {
    matched_anchor_count: number;
    matched_positive_count: number;
    sample_anchor_keys: string[];
    top_event_types: string[];
  };
  caveat: string;
};

export type RootCauseRunResponse = {
  run_id: string;
  anchor_object_type: string;
  start_at: string;
  end_at: string;
  depth: number;
  outcome: OutcomeDefinition;
  cohort_size: number;
  positive_count: number;
  baseline_rate: number;
  feature_count: number;
  insights: InsightResult[];
  warnings: string[];
  interpretation_caveat: string;
};

export type RootCauseEvidenceResponse = {
  handle: string;
  insight_id: string;
  matched_anchor_count: number;
  matched_positive_count: number;
  traces: Array<{
    anchor_key: string;
    anchor_object_type: string;
    anchor_object_ref_hash: number;
    anchor_object_ref_canonical: string;
    outcome: boolean;
    events: Array<{
      event_id: string;
      occurred_at: string;
      event_type: string;
      object_instances: string[];
    }>;
  }>;
  truncated: boolean;
};

export type RootCauseAssistSetupResponse = {
  suggested_depth: number;
  suggestions: Array<{
    outcome: OutcomeDefinition;
    rationale: string;
  }>;
  notes: string[];
};

export type RootCauseAssistInterpretResponse = {
  summary: string;
  caveats: string[];
  next_steps: string[];
};

const DEFAULT_BACKEND_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${DEFAULT_BACKEND_URL}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body || "Request failed"}`);
  }

  return (await response.json()) as T;
}

export function runRootCause(payload: RootCauseRequest): Promise<RootCauseRunResponse> {
  return requestJson<RootCauseRunResponse>("/api/v1/root-cause/run", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchRootCauseEvidence(
  handle: string,
  limit = 10
): Promise<RootCauseEvidenceResponse> {
  const params = new URLSearchParams({ handle, limit: String(limit) });
  return requestJson<RootCauseEvidenceResponse>(`/api/v1/root-cause/evidence?${params.toString()}`);
}

export function assistRootCauseSetup(payload: {
  anchor_object_type: string;
  start_at: string;
  end_at: string;
}): Promise<RootCauseAssistSetupResponse> {
  return requestJson<RootCauseAssistSetupResponse>("/api/v1/root-cause/assist/setup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function assistRootCauseInterpret(payload: {
  baseline_rate: number;
  insights: InsightResult[];
}): Promise<RootCauseAssistInterpretResponse> {
  return requestJson<RootCauseAssistInterpretResponse>("/api/v1/root-cause/assist/interpret", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
