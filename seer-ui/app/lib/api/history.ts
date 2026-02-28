import { fetchApi } from './client';
import type {
  LatestObjectsResponse,
  ObjectEventsResponse,
  ObjectPropertyFilter,
} from '@/app/types/history';

export async function listLatestObjects(options: {
  objectType?: string;
  propertyFilters?: ObjectPropertyFilter[];
  page?: number;
  size?: number;
}): Promise<LatestObjectsResponse> {
  const propertyFilters = (options.propertyFilters || [])
    .map((filter) => ({
      key: filter.key.trim(),
      op: filter.op,
      value: filter.value.trim(),
    }))
    .filter((filter) => filter.key && filter.value);

  return fetchApi<LatestObjectsResponse>('/history/objects/latest/search', {
    method: 'POST',
    body: JSON.stringify({
      object_type: options.objectType?.trim() || undefined,
      page: options.page ?? 0,
      size: options.size ?? 25,
      property_filters: propertyFilters,
    }),
  });
}

export async function listObjectEvents(options: {
  objectType: string;
  objectRefCanonical: string;
  objectRefHash?: number;
  page?: number;
  size?: number;
}): Promise<ObjectEventsResponse> {
  const query = new URLSearchParams();
  query.set('object_type', options.objectType);
  query.set('object_ref_canonical', options.objectRefCanonical);
  if (typeof options.objectRefHash === 'number') {
    query.set('object_ref_hash', String(options.objectRefHash));
  }
  query.set('page', String(options.page ?? 0));
  query.set('size', String(options.size ?? 20));
  return fetchApi<ObjectEventsResponse>(`/history/objects/events?${query.toString()}`);
}
