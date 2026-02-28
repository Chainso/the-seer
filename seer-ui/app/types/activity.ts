export interface ActivityStreamEntry {
  activityType: 'event' | 'action';
  activityId: string;
  activityTime: string;
  typeUri: string;
  objectId: string;
  role: string;
  modelUri: string;
  traceId?: string | null;
  workflowId?: string | null;
  correlationId?: string | null;
}

export interface ObjectGraphNode {
  id: string;
  modelUri: string;
}

export interface ActivityGraphNode {
  id: string;
  activityType: 'event' | 'action';
  typeUri: string;
  activityTime: string;
}

export interface ActivityObjectEdge {
  activityId: string;
  activityType: 'event' | 'action';
  objectId: string;
  role: string;
}

export interface ObjectGraphResponse {
  objects: ObjectGraphNode[];
  activities: ActivityGraphNode[];
  edges: ActivityObjectEdge[];
}
