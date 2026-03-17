import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("catalog is the primary shell entry and ontology routes redirect into catalog", () => {
  const home = read("app/page.tsx");
  const catalogIndex = read("app/catalog/page.tsx");
  const catalogKind = read("app/catalog/[kind]/page.tsx");
  const catalogDetail = read("app/catalog/[kind]/[catalogKey]/page.tsx");
  const ontologyIndex = read("app/ontology/page.tsx");
  const ontologyTab = read("app/ontology/[tab]/page.tsx");
  const nav = read("app/components/layout/nav-sidebar.tsx");

  assert.match(home, /redirect\('\/catalog\/objects'\)/);
  assert.match(catalogIndex, /redirect\("\/catalog\/objects"\)/);
  assert.match(catalogKind, /isCatalogKind/);
  assert.match(catalogKind, /redirect\("\/catalog\/objects"\)/);
  assert.match(catalogKind, /<CatalogListPage kind=\{kind\} \/>/);
  assert.match(catalogDetail, /isCatalogKind/);
  assert.match(catalogDetail, /<CatalogDetailPage kind=\{kind\} catalogKey=\{catalogKey\} \/>/);
  assert.match(ontologyIndex, /redirect\('\/catalog\/objects'\)/);
  assert.match(ontologyTab, /mapLegacyOntologyTabToCatalogKind/);
  assert.match(ontologyTab, /redirect\(`\/catalog\/\$\{catalogKind\}`\)/);
  assert.match(nav, /name:\s*'Catalog'/);
  assert.match(nav, /href:\s*'\/catalog'/);
  assert.match(nav, /name:\s*'Managed Agents'/);
  assert.match(nav, /name:\s*'Assistant'/);
  assert.doesNotMatch(nav, /name:\s*'Ontology Explorer'/);
  assert.doesNotMatch(nav, /name:\s*'Object Store'/);
  assert.doesNotMatch(nav, /name:\s*'Insights'/);
});

test("catalog list and detail surfaces use rail tabs, table-first lists, and dedicated runtime panes", () => {
  const tabs = read("app/components/catalog/catalog-kind-tabs.tsx");
  const list = read("app/components/catalog/catalog-list-page.tsx");
  const detail = read("app/components/catalog/catalog-detail-page.tsx");
  const lifecycle = read("app/components/catalog/object-lifecycle-workspace.tsx");
  const routes = read("app/lib/catalog-routes.ts");

  assert.match(tabs, /TabsList variant="rail"/);
  assert.match(tabs, /CATALOG_KIND_ORDER/);
  assert.match(list, /listCatalogByKind/);
  assert.match(list, /TableRoot variant="surface" striped/);
  assert.match(list, /buildCatalogDetailHref/);
  assert.match(detail, /getCatalogDetailByKind/);
  assert.match(detail, /getCatalogRuntimeByKind/);
  assert.match(detail, /runtimeTitle/);
  assert.match(detail, /TableColumnHeaderCell>Recorded</);
  assert.match(detail, /TableColumnHeaderCell>Reference</);
  assert.match(detail, /TableColumnHeaderCell>Snapshot</);
  assert.match(detail, /TableColumnHeaderCell>Status</);
  assert.match(detail, /TableColumnHeaderCell>Submitted</);
  assert.match(detail, /TableColumnHeaderCell>Completed</);
  assert.match(detail, /TableColumnHeaderCell>Attempts</);
  assert.match(detail, /TableColumnHeaderCell>Occurred</);
  assert.match(detail, /TableColumnHeaderCell>Source</);
  assert.match(detail, /TableColumnHeaderCell>Summary</);
  assert.doesNotMatch(detail, /TableColumnHeaderCell>Source Event</);
  assert.doesNotMatch(detail, /TableColumnHeaderCell>Run</);
  assert.doesNotMatch(detail, /TableColumnHeaderCell>Trace</);
  assert.doesNotMatch(detail, /TableColumnHeaderCell>Payload</);
  assert.doesNotMatch(detail, /item\.source_event_id/);
  assert.doesNotMatch(detail, /item\.trace_id/);
  assert.match(detail, /value="summary"/);
  assert.match(detail, /value="lifecycle"/);
  assert.match(detail, /ObjectLifecycleWorkspace/);
  assert.match(detail, /Summary/);
  assert.match(detail, /Lifecycle/);
  assert.match(detail, /ObjectLifecycleWorkspace[\s\S]*objectType=\{objectDetail\.object_type_uri\}/);
  assert.match(lifecycle, /ObjectStoreInsightsWorkspace/);
  assert.match(lifecycle, /mode="lifecycle"/);
  assert.match(lifecycle, /data-object-lifecycle-workspace/);
  assert.match(routes, /CATALOG_KIND_ORDER/);
  assert.match(routes, /mapLegacyOntologyTabToCatalogKind/);
});

test("catalog API client targets dedicated per-concept endpoints", () => {
  const api = read("app/lib/api/catalog.ts");
  const types = read("app/types/catalog.ts");

  assert.match(api, /\/catalog\/\$\{kind\}/);
  assert.match(api, /\/catalog\/objects\/\$\{catalogKey\}\/instances/);
  assert.match(api, /\/catalog\/actions\/\$\{catalogKey\}\/runs/);
  assert.match(api, /\/catalog\/events\/\$\{catalogKey\}\/occurrences/);
  assert.match(api, /\/catalog\/triggers\/\$\{catalogKey\}\/firings/);
  assert.match(types, /export type CatalogKind = 'objects' \| 'actions' \| 'events' \| 'triggers';/);
  assert.match(types, /CatalogObjectListResponse/);
  assert.match(types, /CatalogTriggerFiringsResponse/);
});
