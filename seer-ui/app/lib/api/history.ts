import { fetchApi } from './client';
import type {
  EventObjectRelationsResponse,
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
  startAt?: string;
  endAt?: string;
  page?: number;
  size?: number;
}): Promise<ObjectEventsResponse> {
  const query = new URLSearchParams();
  query.set('object_type', options.objectType);
  query.set('object_ref_canonical', options.objectRefCanonical);
  if (typeof options.objectRefHash === 'number') {
    query.set('object_ref_hash', String(options.objectRefHash));
  }
  if (options.startAt) {
    query.set('start_at', options.startAt);
  }
  if (options.endAt) {
    query.set('end_at', options.endAt);
  }
  query.set('page', String(options.page ?? 0));
  query.set('size', String(options.size ?? 20));
  return fetchApi<ObjectEventsResponse>(`/history/objects/events?${query.toString()}`);
}

export async function listEventObjectRelations(options: {
  eventId?: string;
  objectType?: string;
  objectRefHash?: number;
  limit?: number;
}): Promise<EventObjectRelationsResponse> {
  const query = new URLSearchParams();
  if (options.eventId) {
    query.set('event_id', options.eventId);
  }
  if (options.objectType) {
    query.set('object_type', options.objectType);
  }
  if (typeof options.objectRefHash === 'number') {
    query.set('object_ref_hash', String(options.objectRefHash));
  }
  query.set('limit', String(options.limit ?? 200));
  return fetchApi<EventObjectRelationsResponse>(`/history/relations?${query.toString()}`);
}
