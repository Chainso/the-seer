import { fetchApi } from './client';
import type { ActivityStreamEntry, ObjectGraphResponse } from '@/app/types/activity';

export async function getObjectTimeline(
  model: string,
  id: string,
  options: {
    from?: string;
    to?: string;
    activityTypes?: string[];
    traceId?: string;
    workflowId?: string;
  }
) {
  return fetchApi<ActivityStreamEntry[]>('/objects/timeline', {
    method: 'POST',
    body: JSON.stringify({
      modelUri: model,
      id,
      from: options.from,
      to: options.to,
      activityTypes: options.activityTypes,
      traceId: options.traceId,
      workflowId: options.workflowId,
    }),
  });
}

export async function getObjectGraph(
  model: string,
  id: string,
  options: {
    depth?: string;
    modelUris?: string[];
    from?: string;
    to?: string;
    activityTypes?: string[];
  }
) {
  return fetchApi<ObjectGraphResponse>('/objects/graph', {
    method: 'POST',
    body: JSON.stringify({
      modelUri: model,
      id,
      depth: options.depth ? Number(options.depth) : undefined,
      modelUris: options.modelUris,
      from: options.from,
      to: options.to,
      activityTypes: options.activityTypes,
    }),
  });
}
