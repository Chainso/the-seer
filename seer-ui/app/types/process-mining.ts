export type OcpnNodeType = "PLACE" | "TRANSITION";

export interface OcpnNode {
  id: string;
  label: string;
  type: OcpnNodeType;
  modelUri?: string | null;
  stateUri?: string | null;
  eventUri?: string | null;
  firstSeen?: string | null;
  lastSeen?: string | null;
  medianSeen?: string | null;
  count?: number | null;
  avgSeconds?: number | null;
  p50Seconds?: number | null;
  p95Seconds?: number | null;
}

export interface OcpnEdge {
  id: string;
  source: string;
  target: string;
  modelUri?: string | null;
  count: number;
  share: number;
}

export interface OcpnGraph {
  nodes: OcpnNode[];
  edges: OcpnEdge[];
}
