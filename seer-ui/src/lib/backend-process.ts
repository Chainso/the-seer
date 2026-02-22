export type ProcessMiningRequest = {
  anchor_object_type: string;
  start_at: string;
  end_at: string;
  include_object_types?: string[];
  max_events?: number;
  max_relations?: number;
  max_traces_per_handle?: number;
};

export type ProcessModelNode = {
  id: string;
  label: string;
  node_type: string;
  frequency: number;
  trace_handle: string;
};

export type ProcessModelEdge = {
  id: string;
  source: string;
  target: string;
  object_type: string;
  count: number;
  trace_handle: string;
};

export type ProcessPathStat = {
  object_type: string;
  path: string;
  count: number;
  trace_handle: string;
};

export type ProcessMiningResponse = {
  run_id: string;
  anchor_object_type: string;
  start_at: string;
  end_at: string;
  nodes: ProcessModelNode[];
  edges: ProcessModelEdge[];
  object_types: string[];
  path_stats: ProcessPathStat[];
  warnings: string[];
};

export type ProcessTraceRecord = {
  object_type: string;
  object_ref_hash: number;
  object_ref_canonical: string;
  event_ids: string[];
  event_types: string[];
  start_at: string;
  end_at: string;
  trace_id: string | null;
};

export type ProcessTraceDrilldownResponse = {
  handle: string;
  selector_type: string;
  traces: ProcessTraceRecord[];
  matched_count: number;
  truncated: boolean;
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

export function runProcessMining(payload: ProcessMiningRequest): Promise<ProcessMiningResponse> {
  return requestJson<ProcessMiningResponse>("/api/v1/process/mine", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchProcessTraceDrilldown(
  handle: string,
  limit = 25
): Promise<ProcessTraceDrilldownResponse> {
  const params = new URLSearchParams({ handle, limit: String(limit) });
  return requestJson<ProcessTraceDrilldownResponse>(`/api/v1/process/traces?${params.toString()}`);
}
