import { fetchApi } from './client';
import type { ObjectPageResponse, ObjectSummaryResponse } from '@/app/types/object';

export async function listObjectsByModel(
  model: string,
  options?: {
    page?: number;
    size?: number;
    states?: string[];
    search?: string;
  }
): Promise<ObjectPageResponse> {
  return fetchApi<ObjectPageResponse>('/objects/query', {
    method: 'POST',
    body: JSON.stringify({
      modelUri: model,
      page: options?.page ?? 0,
      size: options?.size ?? 50,
      states: options?.states,
      search: options?.search,
    }),
  });
}

export async function getObjectSummary(model: string): Promise<ObjectSummaryResponse> {
  return fetchApi<ObjectSummaryResponse>('/objects/summary', {
    method: 'POST',
    body: JSON.stringify({ modelUri: model }),
  });
}
