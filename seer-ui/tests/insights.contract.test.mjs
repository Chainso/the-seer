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

test("inspector page exposes insights tab wired to insights panel", () => {
  const inspectorPage = read("app/inspector/page.tsx");
  const insightsRoute = read("app/inspector/insights/page.tsx");
  const analyticsRoute = read("app/inspector/analytics/page.tsx");

  assert.match(inspectorPage, /TabsTrigger value="insights">Insights<\/TabsTrigger>/);
  assert.match(inspectorPage, /<InsightsPanel \/>/);
  assert.match(insightsRoute, /return <InsightsPanel defaultTab="process-insights" \/>/);
  assert.match(analyticsRoute, /redirect\('\/inspector\/insights'\)/);
});

test("insights panel consolidates root-cause and process-mining tabs", () => {
  const insightsPanel = read("app/components/inspector/insights-panel.tsx");
  const rootCausePanel = read("app/components/inspector/process-insights-panel.tsx");
  const processApi = read("app/lib/api/process-mining.ts");
  const rootCauseApi = read("app/lib/api/root-cause.ts");
  const nav = read("app/components/layout/nav-sidebar.tsx");

  assert.match(insightsPanel, /TabsTrigger value="process-insights">Process Insights<\/TabsTrigger>/);
  assert.match(insightsPanel, /TabsTrigger value="process-mining">Process Mining<\/TabsTrigger>/);
  assert.match(insightsPanel, /<ProcessInsightsPanel \/>/);
  assert.match(insightsPanel, /<ProcessMiningPanel \/>/);
  assert.match(rootCausePanel, /runRootCause/);
  assert.match(rootCausePanel, /getRootCauseEvidence/);
  assert.match(rootCausePanel, /assistRootCauseSetup/);
  assert.match(rootCausePanel, /assistRootCauseInterpret/);
  assert.match(rootCausePanel, /buildReferenceEdges/);
  assert.match(rootCausePanel, /referencesObjectModel/);
  assert.match(rootCausePanel, /Select event type/);
  assert.match(rootCausePanel, /Select filter field/);
  assert.match(processApi, /max_events/);
  assert.match(processApi, /max_relations/);
  assert.match(processApi, /max_traces_per_handle/);
  assert.match(rootCauseApi, /\/root-cause\/run/);
  assert.match(rootCauseApi, /\/root-cause\/evidence/);
  assert.match(rootCauseApi, /\/root-cause\/assist\/setup/);
  assert.match(rootCauseApi, /\/root-cause\/assist\/interpret/);
  assert.match(nav, /name:\s*'Insights'/);
  assert.match(nav, /href:\s*'\/inspector\/insights'/);
  assert.doesNotMatch(nav, /name:\s*'Process Mining'/);
});

test("process insights panel consumes shared ontology display resolver contract", () => {
  const rootCausePanel = read("app/components/inspector/process-insights-panel.tsx");

  assert.match(rootCausePanel, /useOntologyDisplay/);
  assert.match(rootCausePanel, /\.displayEventType\(/);
  assert.match(rootCausePanel, /\.displayObjectType\(/);
  assert.match(rootCausePanel, /\.displayFieldLabel\(/);
  assert.match(rootCausePanel, /\.fieldKindForKey\(/);
  assert.match(rootCausePanel, /\.operatorOptionsForField\(/);
  assert.match(rootCausePanel, /\.defaultOperatorForField\(/);
  assert.match(rootCausePanel, /\.normalizeOperatorForField\(/);
  assert.match(rootCausePanel, /profile:\s*"insights"/);
});
