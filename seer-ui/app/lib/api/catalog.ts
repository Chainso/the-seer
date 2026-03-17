import { fetchApi } from './client';
import type {
  CatalogDetailResponseByKind,
  CatalogKind,
  CatalogListResponseByKind,
  CatalogRuntimeResponseByKind,
} from '@/app/types/catalog';

function withQuery(endpoint: string, query: URLSearchParams): string {
  const serialized = query.toString();
  return serialized ? `${endpoint}?${serialized}` : endpoint;
}

export async function listCatalogByKind<TKind extends CatalogKind>(
  kind: TKind,
  options: { search?: string; limit?: number } = {}
): Promise<CatalogListResponseByKind[TKind]> {
  const query = new URLSearchParams();
  if (options.search?.trim()) {
    query.set('search', options.search.trim());
  }
  if (typeof options.limit === 'number') {
    query.set('limit', String(options.limit));
  }
  return fetchApi<CatalogListResponseByKind[TKind]>(withQuery(`/catalog/${kind}`, query));
}

export async function getCatalogDetailByKind<TKind extends CatalogKind>(
  kind: TKind,
  catalogKey: string
): Promise<CatalogDetailResponseByKind[TKind]> {
  return fetchApi<CatalogDetailResponseByKind[TKind]>(`/catalog/${kind}/${catalogKey}`);
}

export async function getCatalogRuntimeByKind<TKind extends CatalogKind>(
  kind: TKind,
  catalogKey: string,
  options: { page?: number; size?: number; limit?: number; status?: string } = {}
): Promise<CatalogRuntimeResponseByKind[TKind]> {
  const query = new URLSearchParams();

  if (kind === 'objects') {
    if (typeof options.page === 'number') {
      query.set('page', String(options.page));
    }
    if (typeof options.size === 'number') {
      query.set('size', String(options.size));
    }
    return fetchApi<CatalogRuntimeResponseByKind[TKind]>(
      withQuery(`/catalog/objects/${catalogKey}/instances`, query)
    );
  }

  if (kind === 'actions') {
    if (typeof options.page === 'number') {
      query.set('page', String(options.page));
    }
    if (typeof options.size === 'number') {
      query.set('size', String(options.size));
    }
    if (options.status?.trim()) {
      query.set('status', options.status.trim());
    }
    return fetchApi<CatalogRuntimeResponseByKind[TKind]>(
      withQuery(`/catalog/actions/${catalogKey}/runs`, query)
    );
  }

  if (typeof options.limit === 'number') {
    query.set('limit', String(options.limit));
  }

  if (kind === 'events') {
    return fetchApi<CatalogRuntimeResponseByKind[TKind]>(
      withQuery(`/catalog/events/${catalogKey}/occurrences`, query)
    );
  }

  return fetchApi<CatalogRuntimeResponseByKind[TKind]>(
    withQuery(`/catalog/triggers/${catalogKey}/firings`, query)
  );
}
