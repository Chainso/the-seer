import type { CatalogKind } from '@/app/types/catalog';

export const CATALOG_KIND_ORDER: CatalogKind[] = ['objects', 'actions', 'events', 'triggers'];

export const CATALOG_KIND_LABEL: Record<CatalogKind, string> = {
  objects: 'Objects',
  actions: 'Actions',
  events: 'Events',
  triggers: 'Triggers',
};

export function isCatalogKind(value: string): value is CatalogKind {
  return CATALOG_KIND_ORDER.includes(value as CatalogKind);
}

export function normalizeCatalogKind(value: string | null | undefined): CatalogKind {
  if (value && isCatalogKind(value)) {
    return value;
  }
  return 'objects';
}

export function buildCatalogKindHref(kind: CatalogKind): string {
  return `/catalog/${kind}`;
}

export function buildCatalogDetailHref(kind: CatalogKind, catalogKey: string): string {
  return `/catalog/${kind}/${catalogKey}`;
}

export function mapLegacyOntologyTabToCatalogKind(tab: string | null | undefined): CatalogKind {
  if (!tab || tab === 'overview') {
    return 'objects';
  }
  return normalizeCatalogKind(tab);
}
