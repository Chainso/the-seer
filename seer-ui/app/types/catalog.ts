export type CatalogKind = 'objects' | 'actions' | 'events' | 'triggers';

export interface CatalogConceptLink {
  catalog_key: string;
  name: string;
}

export interface CatalogObjectListItem {
  catalog_key: string;
  name: string;
  description: string | null;
  action_count: number;
  event_count: number;
}

export interface CatalogActionListItem {
  catalog_key: string;
  name: string;
  description: string | null;
  object_count: number;
  trigger_count: number;
}

export interface CatalogEventListItem {
  catalog_key: string;
  name: string;
  description: string | null;
  object_count: number;
  trigger_count: number;
}

export interface CatalogTriggerListItem {
  catalog_key: string;
  name: string;
  description: string | null;
  event_count: number;
  action_count: number;
}

export interface CatalogObjectListResponse {
  items: CatalogObjectListItem[];
}

export interface CatalogActionListResponse {
  items: CatalogActionListItem[];
}

export interface CatalogEventListResponse {
  items: CatalogEventListItem[];
}

export interface CatalogTriggerListResponse {
  items: CatalogTriggerListItem[];
}

export interface CatalogObjectDetailResponse {
  catalog_key: string;
  name: string;
  description: string | null;
  documentation: string | null;
  object_type_uri: string;
  actions: CatalogConceptLink[];
  events: CatalogConceptLink[];
  triggers: CatalogConceptLink[];
}

export interface CatalogActionDetailResponse {
  catalog_key: string;
  name: string;
  description: string | null;
  documentation: string | null;
  objects: CatalogConceptLink[];
  events: CatalogConceptLink[];
  triggers: CatalogConceptLink[];
}

export interface CatalogEventDetailResponse {
  catalog_key: string;
  name: string;
  description: string | null;
  documentation: string | null;
  objects: CatalogConceptLink[];
  actions: CatalogConceptLink[];
  triggers: CatalogConceptLink[];
}

export interface CatalogTriggerDetailResponse {
  catalog_key: string;
  name: string;
  description: string | null;
  documentation: string | null;
  events: CatalogConceptLink[];
  actions: CatalogConceptLink[];
  objects: CatalogConceptLink[];
}

export interface CatalogObjectInstanceItem {
  instance_id: string;
  recorded_at: string;
  source_event_id: string | null;
  reference: Record<string, unknown>;
  data: Record<string, unknown>;
}

export interface CatalogObjectInstancesResponse {
  catalog_key: string;
  name: string;
  page: number;
  size: number;
  total: number;
  total_pages: number;
  instances: CatalogObjectInstanceItem[];
}

export interface CatalogActionRunItem {
  run_id: string;
  status: string;
  submitted_at: string;
  updated_at: string;
  completed_at: string | null;
  attempt_count: number;
  last_error_code: string | null;
  last_error_detail: string | null;
}

export interface CatalogActionRunsResponse {
  catalog_key: string;
  name: string;
  page: number;
  size: number;
  total: number;
  runs: CatalogActionRunItem[];
}

export interface CatalogEventOccurrenceItem {
  event_id: string;
  occurred_at: string;
  source: string;
  trace_id: string | null;
  produced_by_execution_id: string | null;
  payload: Record<string, unknown>;
}

export interface CatalogEventOccurrencesResponse {
  catalog_key: string;
  name: string;
  limit: number;
  occurrences: CatalogEventOccurrenceItem[];
}

export interface CatalogTriggerFiringItem {
  event_id: string;
  occurred_at: string;
  source: string;
  trace_id: string | null;
  payload: Record<string, unknown>;
}

export interface CatalogTriggerFiringsResponse {
  catalog_key: string;
  name: string;
  event: CatalogConceptLink | null;
  action: CatalogConceptLink | null;
  limit: number;
  firings: CatalogTriggerFiringItem[];
}

export type CatalogListResponseByKind = {
  objects: CatalogObjectListResponse;
  actions: CatalogActionListResponse;
  events: CatalogEventListResponse;
  triggers: CatalogTriggerListResponse;
};

export type CatalogDetailResponseByKind = {
  objects: CatalogObjectDetailResponse;
  actions: CatalogActionDetailResponse;
  events: CatalogEventDetailResponse;
  triggers: CatalogTriggerDetailResponse;
};

export type CatalogRuntimeResponseByKind = {
  objects: CatalogObjectInstancesResponse;
  actions: CatalogActionRunsResponse;
  events: CatalogEventOccurrencesResponse;
  triggers: CatalogTriggerFiringsResponse;
};
