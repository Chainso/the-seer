export interface FlowMetric {
  fromState: string;
  toState: string;
  count: number;
  share: number;
}

export interface StateDurationMetric {
  stateUri: string;
  count: number;
  avgSeconds: number;
  p50Seconds: number;
  p95Seconds: number;
}

export interface RuntimeOverlayQuery {
  modelUri: string;
  from?: string;
  to?: string;
  filters?: Record<string, string>;
  traceId?: string;
  workflowId?: string;
}

export interface RuntimeOverlayStats {
  totalFlowCount: number;
  transitionPairCount: number;
  stateDurationCount: number;
}

export interface OntologyRuntimeOverlay {
  query: RuntimeOverlayQuery;
  generatedAt: string;
  flows: FlowMetric[];
  stateDurations: StateDurationMetric[];
  stats: RuntimeOverlayStats;
}
