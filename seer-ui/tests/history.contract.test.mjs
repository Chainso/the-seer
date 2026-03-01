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
  const nav = read("app/components/layout/nav-sidebar.tsx");

  assert.match(inspectorPage, /redirect\('\/inspector\/history'\)/);
  assert.match(historyRoute, /return <HistoryPanel \/>/);
  assert.match(objectRoute, /return <ObjectHistoryDetailsPanel \/>/);
  assert.match(historyPanel, /Object Store/);
  assert.match(historyPanel, /Live Objects/);
  assert.match(historyPanel, /router\.push\(`\/inspector\/history\/object\?/);
  assert.match(historyPanel, /object_type/);
  assert.match(historyPanel, /object_ref_canonical/);
  assert.match(historyPanel, /<Table\.Root[\s\S]*striped/);
  assert.doesNotMatch(historyPanel, /Graph Controls/);
  assert.doesNotMatch(historyPanel, /Graph View/);
  assert.doesNotMatch(historyPanel, /Load older/);
  assert.match(detailsPanel, /Graph time source/);
  assert.match(detailsPanel, /Follow Timeline/);
  assert.match(detailsPanel, /Custom Range/);
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

  assert.match(historyPanel, /useOntologyDisplay/);
  assert.match(historyPanel, /\.displayObjectType\(/);
  assert.match(historyPanel, /\.displayFieldLabel\(/);
  assert.match(historyPanel, /\.fieldKindForKey\(/);
  assert.match(historyPanel, /\.operatorOptionsForField\(/);
  assert.match(historyPanel, /profile:\s*"history"/);

  assert.match(detailsPanel, /useOntologyDisplay/);
  assert.match(detailsPanel, /\.displayObjectType\(/);
  assert.match(detailsPanel, /\.displayEventType\(/);
  assert.match(detailsPanel, /\.displayFieldLabel\(/);
  assert.match(detailsPanel, /\.displayFieldValue\(/);
  assert.match(detailsPanel, /\.summarizeObjectRef\(/);
  assert.match(detailsPanel, /\.summarizePayload\(/);
  assert.match(detailsPanel, /buildTimelineHighlights/);
  assert.match(detailsPanel, /resolveStateTransition/);
  assert.match(detailsPanel, /Timeline by Day/);
  assert.match(detailsPanel, /toLocaleDateString\(undefined,\s*\{\s*weekday:\s*"short"/);
  assert.match(detailsPanel, /<ObjectHistoryTimeline/);
  assert.match(detailsPanel, /groups=\{timelineGroups\}/);
  assert.doesNotMatch(detailsPanel, /workflow/i);
  assert.doesNotMatch(detailsPanel, /trace id/i);
  assert.doesNotMatch(detailsPanel, /workflow id/i);
});
