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

test("inspector root and object store route follow the forward-only history IA", () => {
  const inspectorPage = read("app/inspector/page.tsx");
  const historyRoute = read("app/inspector/history/page.tsx");
  const objectRoute = read("app/inspector/history/object/page.tsx");
  const historyPanel = read("app/components/inspector/history-panel.tsx");
  const detailsPanel = read("app/components/inspector/object-history-details-panel.tsx");
  const displaySurface = read("app/components/inspector/object-history-display-surface.tsx");
  const nav = read("app/components/layout/nav-sidebar.tsx");

  assert.match(inspectorPage, /redirect\('\/inspector\/history'\)/);
  assert.match(historyRoute, /return <HistoryPanel \/>/);
  assert.match(objectRoute, /<ObjectHistoryDetailsPanel \/>/);
  assert.match(historyPanel, /History Filters/);
  assert.match(historyPanel, /Live Objects/);
  assert.match(historyPanel, /router\.push\(`\/inspector\/history\/object\?/);
  assert.match(historyPanel, /object_type/);
  assert.match(historyPanel, /object_ref_canonical/);
  assert.match(historyPanel, /<Table\.Root[\s\S]*striped/);
  assert.doesNotMatch(historyPanel, /Graph Controls/);
  assert.doesNotMatch(historyPanel, /Graph View/);
  assert.doesNotMatch(historyPanel, /Load older/);
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
  const detailsPanel = read("app/components/inspector/object-history-details-panel.tsx");
  const displayHook = read("app/components/inspector/use-object-history-display-data.ts");
  const displaySurface = read("app/components/inspector/object-history-display-surface.tsx");

  assert.match(historyPanel, /useOntologyDisplay/);
  assert.match(historyPanel, /\.displayObjectType\(/);
  assert.match(historyPanel, /\.displayFieldLabel\(/);
  assert.match(historyPanel, /\.fieldKindForKey\(/);
  assert.match(historyPanel, /\.operatorOptionsForField\(/);
  assert.match(historyPanel, /profile:\s*"history"/);

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
