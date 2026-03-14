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

test("inspector root and object store route expose model-locked object store tabs plus object details", () => {
  const inspectorPage = read("app/inspector/page.tsx");
  const historyRoute = read("app/inspector/history/page.tsx");
  const objectRoute = read("app/inspector/history/object/page.tsx");
  const historyPanel = read("app/components/inspector/history-panel.tsx");
  const insightsWorkspace = read("app/components/inspector/object-store-insights-workspace.tsx");
  const liveObjectsPanel = read("app/components/inspector/history-live-objects-panel.tsx");
  const detailsPanel = read("app/components/inspector/object-history-details-panel.tsx");
  const displaySurface = read("app/components/inspector/object-history-display-surface.tsx");
  const nav = read("app/components/layout/nav-sidebar.tsx");

  assert.match(inspectorPage, /redirect\('\/inspector\/history'\)/);
  assert.match(historyRoute, /connection\(\)/);
  assert.match(historyRoute, /<Suspense fallback=\{<HistoryPageFallback \/>}/);
  assert.match(historyRoute, /<HistoryPanel \/>/);
  assert.match(objectRoute, /<ObjectHistoryDetailsPanel \/>/);
  assert.match(historyPanel, /Object model/);
  assert.match(historyPanel, /Object Store always stays scoped to one object model/);
  assert.match(historyPanel, /value="objects"/);
  assert.match(historyPanel, /value="insights"/);
  assert.match(historyPanel, /ObjectStoreInsightsWorkspace/);
  assert.doesNotMatch(historyPanel, /InsightsPanel/);
  assert.match(insightsWorkspace, /runRootCause/);
  assert.match(insightsWorkspace, /getOcdfgGraph/);
  assert.match(insightsWorkspace, /Run RCA/);
  assert.match(insightsWorkspace, /Primary OC-DFG reruns automatically/);
  assert.match(insightsWorkspace, /Comparison graph currently supports anchor-field RCA rules only/);
  assert.match(insightsWorkspace, /heightClass="h-\[360px\]"/);
  assert.match(insightsWorkspace, /anchorFilters:/);
  assert.match(liveObjectsPanel, /History Filters/);
  assert.match(liveObjectsPanel, /displayNameFieldKey/);
  assert.match(liveObjectsPanel, /displayFieldLabel\(displayNameFieldKey/);
  assert.match(liveObjectsPanel, /router\.push\(`\/inspector\/history\/object\?/);
  assert.match(historyPanel, /object_type/);
  assert.match(liveObjectsPanel, /object_ref_canonical/);
  assert.match(liveObjectsPanel, /<Table\.Root[\s\S]*striped/);
  assert.match(liveObjectsPanel, /display_name/);
  assert.match(liveObjectsPanel, /stateFilterFieldKey/);
  assert.match(detailsPanel, /ObjectHistoryDisplaySurface/);
  assert.match(detailsPanel, /Graph time source/);
  assert.match(detailsPanel, /Follow Timeline/);
  assert.match(detailsPanel, /Custom Range/);
  assert.match(displaySurface, /Timeline by Day/);
  assert.match(displaySurface, /Load older/);
  assert.doesNotMatch(displaySurface, /Object-Centric Timeline \+ Graph/);
  assert.match(nav, /name:\s*'Object Store'/);
  assert.match(nav, /href:\s*'\/inspector\/history'/);
});

test("history API client targets canonical history endpoints for object discovery + graph construction", () => {
  const historyApi = read("app/lib/api/history.ts");

  assert.match(historyApi, /\/history\/objects\/latest\/search/);
  assert.match(historyApi, /method:\s*'POST'/);
  assert.match(historyApi, /property_filters/);
  assert.match(historyApi, /\/history\/objects\/events/);
  assert.match(historyApi, /start_at/);
  assert.match(historyApi, /end_at/);
  assert.match(historyApi, /\/history\/relations/);
});

test("history surfaces consume shared ontology display resolver contracts", () => {
  const historyPanel = read("app/components/inspector/history-panel.tsx");
  const liveObjectsPanel = read("app/components/inspector/history-live-objects-panel.tsx");
  const detailsPanel = read("app/components/inspector/object-history-details-panel.tsx");
  const displayHook = read("app/components/inspector/use-object-history-display-data.ts");
  const displaySurface = read("app/components/inspector/object-history-display-surface.tsx");

  assert.match(historyPanel, /useOntologyDisplay/);
  assert.match(historyPanel, /displayObjectType/);
  assert.match(historyPanel, /SearchableSelect/);
  assert.match(historyPanel, /mergeSearchParams/);
  assert.match(liveObjectsPanel, /useOntologyDisplay/);
  assert.match(liveObjectsPanel, /\.displayFieldLabel\(/);
  assert.match(liveObjectsPanel, /\.displayFieldValue\(/);
  assert.match(liveObjectsPanel, /\.fieldKindForKey\(/);
  assert.match(liveObjectsPanel, /\.operatorOptionsForField\(/);
  assert.match(liveObjectsPanel, /profile:\s*"history"/);

  assert.match(detailsPanel, /useObjectHistoryDisplayData/);
  assert.match(detailsPanel, /ObjectHistoryDisplaySurface/);
  assert.match(displayHook, /useOntologyDisplay/);
  assert.match(displayHook, /\.displayObjectType\(/);
  assert.match(displayHook, /\.displayEventType\(/);
  assert.match(displayHook, /\.displayFieldLabel\(/);
  assert.match(displayHook, /\.displayFieldValue\(/);
  assert.match(displayHook, /\.summarizeObjectRef\(/);
  assert.match(displayHook, /\.summarizePayload\(/);
  assert.match(displayHook, /buildTimelineHighlights/);
  assert.match(displayHook, /resolveStateTransition/);
  assert.match(displayHook, /toLocaleDateString\(undefined,\s*\{\s*weekday:\s*"short"/);
  assert.match(displaySurface, /<ObjectHistoryActivityGraph/);
  assert.match(displaySurface, /<ObjectHistoryTimeline/);
  assert.match(displaySurface, /timelineGroups/);
  assert.doesNotMatch(displaySurface, /workflow/i);
  assert.doesNotMatch(displaySurface, /trace id/i);
  assert.doesNotMatch(displaySurface, /workflow id/i);
});
