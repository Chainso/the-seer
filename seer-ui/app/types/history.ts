export type PropertyFilterOperator = 'eq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';

export interface ObjectPropertyFilter {
  key: string;
  op: PropertyFilterOperator;
  value: string;
}

export interface LatestObjectItem {
  object_history_id: string;
  object_type: string;
  object_ref: Record<string, unknown>;
  object_ref_canonical: string;
  object_ref_hash: number;
  object_payload: Record<string, unknown>;
  recorded_at: string;
  source_event_id: string | null;
}

export interface LatestObjectsResponse {
  items: LatestObjectItem[];
  page: number;
  size: number;
  total: number;
  total_pages: number;
}

export interface ObjectEventItem {
  event_id: string;
  occurred_at: string | null;
  event_type: string | null;
  source: string | null;
  trace_id: string | null;
  payload: Record<string, unknown> | null;
  attributes: Record<string, unknown> | null;
  relation_role: string | null;
  linked_at: string;
  object_history_id: string;
  recorded_at: string | null;
  object_payload: Record<string, unknown> | null;
}

export interface ObjectEventsResponse {
  items: ObjectEventItem[];
  page: number;
  size: number;
  total: number;
  total_pages: number;
}

export interface EventObjectRelationItem {
  event_id: string;
  object_history_id: string;
  object_type: string;
  object_ref: Record<string, unknown>;
  object_ref_canonical: string;
  object_ref_hash: number;
  relation_role: string | null;
  linked_at: string;
  occurred_at: string | null;
  event_type: string | null;
  source: string | null;
  object_payload: Record<string, unknown> | null;
  recorded_at: string | null;
}

export interface EventObjectRelationsResponse {
  items: EventObjectRelationItem[];
}
