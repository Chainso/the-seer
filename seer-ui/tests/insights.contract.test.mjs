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

test("inspector page exposes insights route and analytics redirect", () => {
  const insightsRoute = read("app/inspector/insights/page.tsx");
  const analyticsRoute = read("app/inspector/analytics/page.tsx");

  assert.match(insightsRoute, /connection\(\)/);
  assert.match(insightsRoute, /<Suspense fallback=\{<InsightsPageFallback \/>}/);
  assert.match(insightsRoute, /<InsightsPanel defaultTab="process-insights" \/>/);
  assert.match(analyticsRoute, /redirect\('\/inspector\/insights'\)/);
});

test("insights panel consolidates root-cause and process-mining tabs", () => {
  const insightsPanel = read("app/components/inspector/insights-panel.tsx");
  const rootCausePanel = read("app/components/inspector/process-insights-panel.tsx");
  const rootCauseSurface = read("app/components/inspector/root-cause-results-surface.tsx");
  const processApi = read("app/lib/api/process-mining.ts");
  const rootCauseApi = read("app/lib/api/root-cause.ts");
  const nav = read("app/components/layout/nav-sidebar.tsx");

  assert.match(insightsPanel, /value="process-insights"/);
  assert.match(insightsPanel, /value="process-mining"/);
  assert.match(insightsPanel, /label: "RCA"/);
  assert.match(insightsPanel, /label: "OC-DFG"/);
  assert.match(insightsPanel, /queryKey = "tab"/);
  assert.match(insightsPanel, /lockedAnchorModelUri = null/);
  assert.match(insightsPanel, /<ProcessInsightsPanel[\s\S]*isActive=\{activeTab === "process-insights"\}[\s\S]*lockedAnchorModelUri=\{lockedAnchorModelUri\}[\s\S]*\/>/);
  assert.match(insightsPanel, /<ProcessMiningPanel[\s\S]*isActive=\{activeTab === "process-mining"\}[\s\S]*lockedModelUri=\{lockedAnchorModelUri\}[\s\S]*\/>/);
  assert.match(insightsPanel, /useSearchParams/);
  assert.match(insightsPanel, /mergeSearchParams/);
  assert.doesNotMatch(insightsPanel, /Investigate Process Behavior/);
  assert.match(rootCausePanel, /runRootCause/);
  assert.match(rootCausePanel, /getRootCauseEvidence/);
  assert.match(rootCausePanel, /assistRootCauseSetup/);
  assert.match(rootCausePanel, /assistRootCauseInterpret/);
  assert.match(rootCausePanel, /RootCauseResultsSurface/);
  assert.match(rootCausePanel, /buildReferenceEdges/);
  assert.match(rootCausePanel, /referencesObjectModel/);
  assert.match(rootCausePanel, /Select event type/);
  assert.match(rootCausePanel, /Select filter field/);
  assert.match(rootCauseSurface, /data-root-cause-results-surface/);
  assert.match(rootCauseSurface, /Evidence Traces/);
  assert.match(rootCauseSurface, /AI Interpretation/);
  assert.doesNotMatch(rootCausePanel, /showIntro\?:/);
  assert.doesNotMatch(rootCausePanel, /Root-Cause Intelligence/);
  assert.match(processApi, /max_events/);
  assert.match(processApi, /max_relations/);
  assert.match(processApi, /max_traces_per_handle/);
  assert.match(processApi, /include_object_types/);
  assert.match(processApi, /\/process\/ocdfg\/mine/);
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
  assert.match(rootCausePanel, /lockedAnchorModelUri/);
  assert.match(rootCausePanel, /modelLocked=\{isAnchorModelLocked\}/);
  assert.match(rootCausePanel, /\.displayEventType\(/);
  assert.match(rootCausePanel, /\.displayObjectType\(/);
  assert.match(rootCausePanel, /\.displayFieldLabel\(/);
  assert.match(rootCausePanel, /\.fieldKindForKey\(/);
  assert.match(rootCausePanel, /\.operatorOptionsForField\(/);
  assert.match(rootCausePanel, /\.defaultOperatorForField\(/);
  assert.match(rootCausePanel, /\.normalizeOperatorForField\(/);
  assert.match(rootCausePanel, /profile:\s*"insights"/);
});

test("process mining panel consumes shared ontology display resolver contract", () => {
  const processMiningPanel = read("app/components/inspector/process-mining-panel.tsx");
  const processApi = read("app/lib/api/process-mining.ts");

  assert.match(processMiningPanel, /useOntologyDisplay/);
  assert.match(processMiningPanel, /lockedModelUri/);
  assert.match(processMiningPanel, /modelLocked=\{isModelLocked\}/);
  assert.match(processMiningPanel, /buildReferenceEdges/);
  assert.match(processMiningPanel, /\.displayObjectType\(/);
  assert.match(processMiningPanel, /\.displayEventType\(/);
  assert.match(processMiningPanel, /catalog\.objectModels/);
  assert.match(processMiningPanel, /Depth/);
  assert.match(processMiningPanel, /Included object models/);
  assert.match(processMiningPanel, /modelUris:\s*resolvedModelUris/);
  assert.match(processMiningPanel, /Object-Centric Directly-Follows Graph \(Primary\)/);
  assert.match(processApi, /include_object_types:\s*includeObjectTypes/);
  assert.match(processMiningPanel, /getOcdfgGraph/);
  assert.match(processApi, /\/process\/ocdfg\/mine/);
  assert.doesNotMatch(processApi, /\/process\/mine/);
  assert.doesNotMatch(processMiningPanel, /Object-Centric Petri Net \(Secondary\)/);
  assert.doesNotMatch(processMiningPanel, /Inductive Miner \(BPMN\)/);
  assert.doesNotMatch(processMiningPanel, /Secondary OCPN options/);
  assert.doesNotMatch(processMiningPanel, /Trace ID \(optional\)/);
  assert.doesNotMatch(processMiningPanel, /Workflow ID \(optional\)/);
  assert.doesNotMatch(processApi, /traceId\?:/);
  assert.doesNotMatch(processApi, /workflowId\?:/);
  assert.doesNotMatch(processMiningPanel, /showIntro\?:/);
  assert.doesNotMatch(processMiningPanel, /Object-Centric Process Explorer/);
  assert.doesNotMatch(processMiningPanel, /const iriLocalName =/);
  assert.doesNotMatch(processMiningPanel, /const ontologyNodeName =/);
});

test("obsolete standalone object activity panel surface is removed", () => {
  const objectActivityPanelPath = path.join(root, "app/components/inspector/object-activity-panel.tsx");
  const nav = read("app/components/layout/nav-sidebar.tsx");

  assert.equal(fs.existsSync(objectActivityPanelPath), false);
  assert.doesNotMatch(nav, /Process Inspector/);
});
