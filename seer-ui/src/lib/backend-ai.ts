export type AiEvidenceItem = {
  label: string;
  detail: string;
  uri: string | null;
};

export type AiAssistEnvelope = {
  module: "ontology" | "process" | "root_cause";
  task: string;
  response_policy: "informational" | "analytical";
  tool_permissions: string[];
  summary: string;
  evidence: AiEvidenceItem[];
  caveats: string[];
  next_actions: string[];
};

export type AiOntologyQuestionResponse = AiAssistEnvelope & {
  module: "ontology";
  task: "question";
  copilot: {
    mode: "direct_answer" | "tool_call";
    answer: string;
    evidence: Array<{
      concept_iri: string;
      query: string;
    }>;
    current_release_id: string | null;
    tool_call: {
      tool: "sparql_read_only_query";
      query: string;
    } | null;
    tool_result: {
      tool: "sparql_read_only_query";
      query: string;
      query_type: "SELECT" | "ASK" | null;
      variables: string[];
      rows: Array<Record<string, string>>;
      ask_result: boolean | null;
      row_count: number;
      truncated: boolean;
      graphs: string[];
      error: string | null;
    } | null;
  };
};

export type ProcessRunForAi = {
  run_id: string;
  anchor_object_type: string;
  start_at: string;
  end_at: string;
  nodes: Array<{
    id: string;
    label: string;
    node_type: string;
    frequency: number;
    trace_handle: string;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    object_type: string;
    count: number;
    trace_handle: string;
  }>;
  object_types: string[];
  path_stats: Array<{
    object_type: string;
    path: string;
    count: number;
    trace_handle: string;
  }>;
  warnings: string[];
};

export type AiProcessInterpretResponse = AiAssistEnvelope & {
  module: "process";
  task: "interpret";
};

export type AiRootCauseSetupResponse = AiAssistEnvelope & {
  module: "root_cause";
  task: "setup";
  setup: {
    suggested_depth: number;
    suggestions: Array<{
      outcome: {
        kind?: "event_type";
        event_type: string;
        object_type?: string | null;
      };
      rationale: string;
    }>;
    notes: string[];
  };
};

export type InsightForAi = {
  insight_id: string;
  rank: number;
  title: string;
  conditions: Array<{
    feature: string;
    op: "eq";
    value: string;
  }>;
  score: {
    wracc: number;
    mutual_information: number | null;
    coverage: number;
    support: number;
    positives: number;
    subgroup_rate: number;
    baseline_rate: number;
    lift: number;
  };
  evidence_handle: string;
  evidence: {
    matched_anchor_count: number;
    matched_positive_count: number;
    sample_anchor_keys: string[];
    top_event_types: string[];
  };
  caveat: string;
};

export type AiRootCauseInterpretResponse = AiAssistEnvelope & {
  module: "root_cause";
  task: "interpret";
  interpretation: {
    summary: string;
    caveats: string[];
    next_steps: string[];
  };
};

export type GuidedInvestigationResponse = {
  investigation_id: string;
  anchor_object_type: string;
  start_at: string;
  end_at: string;
  ontology: AiOntologyQuestionResponse;
  process_run: ProcessRunForAi;
  process_ai: AiProcessInterpretResponse;
  root_cause_setup: AiRootCauseSetupResponse;
  root_cause_run: {
    run_id: string;
    anchor_object_type: string;
    start_at: string;
    end_at: string;
    depth: number;
    outcome: {
      kind?: "event_type";
      event_type: string;
      object_type?: string | null;
    };
    cohort_size: number;
    positive_count: number;
    baseline_rate: number;
    feature_count: number;
    insights: InsightForAi[];
    warnings: string[];
    interpretation_caveat: string;
  };
  root_cause_ai: AiRootCauseInterpretResponse;
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

export function askAiOntologyQuestion(payload: {
  question: string;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<AiOntologyQuestionResponse> {
  return requestJson<AiOntologyQuestionResponse>("/api/v1/ai/ontology/question", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function interpretAiProcessRun(payload: {
  run: ProcessRunForAi;
}): Promise<AiProcessInterpretResponse> {
  return requestJson<AiProcessInterpretResponse>("/api/v1/ai/process/interpret", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function assistAiRootCauseSetup(payload: {
  anchor_object_type: string;
  start_at: string;
  end_at: string;
}): Promise<AiRootCauseSetupResponse> {
  return requestJson<AiRootCauseSetupResponse>("/api/v1/ai/root-cause/setup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function interpretAiRootCause(payload: {
  baseline_rate: number;
  insights: InsightForAi[];
}): Promise<AiRootCauseInterpretResponse> {
  return requestJson<AiRootCauseInterpretResponse>("/api/v1/ai/root-cause/interpret", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function runGuidedInvestigation(payload: {
  question: string;
  anchor_object_type: string;
  start_at: string;
  end_at: string;
  depth: number;
  outcome_event_type?: string;
}): Promise<GuidedInvestigationResponse> {
  return requestJson<GuidedInvestigationResponse>("/api/v1/ai/guided-investigation", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
