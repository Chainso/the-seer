export type HistoryJsonObject = Record<string, unknown>;

export type HistoryEventItem = {
  event_id: string;
  occurred_at: string;
  event_type: string;
  source: string;
  payload: HistoryJsonObject;
  trace_id: string | null;
  attributes: HistoryJsonObject | null;
  ingested_at: string;
};

export type HistoryEventTimelineResponse = {
  items: HistoryEventItem[];
};

export type HistoryObjectTimelineItem = {
  object_history_id: string;
  object_type: string;
  object_ref: HistoryJsonObject;
  object_ref_canonical: string;
  object_ref_hash: number;
  object_payload: HistoryJsonObject;
  recorded_at: string;
  source_event_id: string | null;
};

export type HistoryObjectTimelineResponse = {
  items: HistoryObjectTimelineItem[];
};

export type HistoryRelationItem = {
  event_id: string;
  object_history_id: string;
  object_type: string;
  object_ref: HistoryJsonObject;
  object_ref_canonical: string;
  object_ref_hash: number;
  relation_role: string | null;
  linked_at: string;
  occurred_at: string | null;
  event_type: string | null;
  source: string | null;
  object_payload: HistoryJsonObject | null;
  recorded_at: string | null;
};

export type HistoryRelationsResponse = {
  items: HistoryRelationItem[];
};

export type FetchHistoryObjectTimelineParams = {
  object_type: string;
  object_ref_hash: string;
  start_at?: string;
  end_at?: string;
  limit?: number;
};

export type FetchHistoryEventsParams = {
  start_at?: string;
  end_at?: string;
  event_type?: string;
  limit?: number;
};

export type FetchHistoryRelationsParams =
  | {
      event_id: string;
      object_type?: never;
      object_ref_hash?: never;
      limit?: number;
    }
  | {
      event_id?: never;
      object_type: string;
      object_ref_hash: string;
      limit?: number;
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

export function fetchHistoryObjectTimeline(
  params: FetchHistoryObjectTimelineParams
): Promise<HistoryObjectTimelineResponse> {
  const query = new URLSearchParams({
    object_type: params.object_type,
    object_ref_hash: params.object_ref_hash,
    limit: String(params.limit ?? 200),
  });

  if (params.start_at) {
    query.set("start_at", params.start_at);
  }
  if (params.end_at) {
    query.set("end_at", params.end_at);
  }

  return requestJson<HistoryObjectTimelineResponse>(
    `/api/v1/history/objects/timeline?${query.toString()}`
  );
}

export function fetchHistoryRelations(
  params: FetchHistoryRelationsParams
): Promise<HistoryRelationsResponse> {
  const query = new URLSearchParams({ limit: String(params.limit ?? 200) });

  if ("event_id" in params && typeof params.event_id === "string") {
    query.set("event_id", params.event_id);
  } else {
    query.set("object_type", params.object_type);
    query.set("object_ref_hash", params.object_ref_hash);
  }

  return requestJson<HistoryRelationsResponse>(`/api/v1/history/relations?${query.toString()}`);
}

export function fetchHistoryEvents(
  params: FetchHistoryEventsParams
): Promise<HistoryEventTimelineResponse> {
  const query = new URLSearchParams({ limit: String(params.limit ?? 200) });

  if (params.start_at) {
    query.set("start_at", params.start_at);
  }
  if (params.end_at) {
    query.set("end_at", params.end_at);
  }
  if (params.event_type) {
    query.set("event_type", params.event_type);
  }

  return requestJson<HistoryEventTimelineResponse>(`/api/v1/history/events?${query.toString()}`);
}
