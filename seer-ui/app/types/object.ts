export interface ObjectInstance {
  id: string;
  modelUri: string;
  stateUri: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ObjectPageResponse {
  items: ObjectInstance[];
  page: number;
  size: number;
  total: number;
  totalPages: number;
}

export interface ObjectStateCount {
  stateUri: string;
  count: number;
}

export interface ObjectSummaryResponse {
  total: number;
  lastUpdatedAt: string | null;
  states: ObjectStateCount[];
}
