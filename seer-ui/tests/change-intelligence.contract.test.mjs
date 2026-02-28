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

test("route and navigation wire change intelligence as first-class surface", () => {
  const nav = read("app/components/layout/nav-sidebar.tsx");
  const changesPage = read("app/changes/page.tsx");

  assert.match(nav, /name:\s*'Change Intelligence'/);
  assert.match(nav, /href:\s*'\/changes'/);
  assert.match(changesPage, /SemanticDiffPanel/);
});

test("semantic diff panel includes ownership, governance, and performance views", () => {
  const panel = read("app/components/changes/semantic-diff-panel.tsx");

  assert.match(panel, /Semantic PR Diff/);
  assert.match(panel, /Blast Radius and Ownership/);
  assert.match(panel, /Governance Scorecard/);
  assert.match(panel, /Performance Budgets/);
});

test("change intelligence contract includes blast radius and governance scorecard", () => {
  const types = read("app/types/changes.ts");
  const api = read("app/lib/api/changes.ts");

  assert.match(types, /export interface BlastRadiusEntry/);
  assert.match(types, /export interface GovernanceScorecard/);
  assert.match(types, /blastRadius:\s*BlastRadiusEntry\[]/);
  assert.match(types, /governance:\s*GovernanceScorecard/);
  assert.match(api, /\/changes\/semantic-diff/);
});

test("core performance budgets are instrumented for explorer, diff, and runtime overlay", () => {
  const perf = read("app/lib/performance-budget.ts");
  const ontologyTabPage = read("app/ontology/[tab]/page.tsx");
  const changesApi = read("app/lib/api/changes.ts");
  const analyticsApi = read("app/lib/api/analytics.ts");

  assert.match(perf, /ontology_graph_load_ms/);
  assert.match(perf, /semantic_diff_load_ms/);
  assert.match(perf, /runtime_overlay_load_ms/);
  assert.match(ontologyTabPage, /recordPerformanceMetric\('ontology_graph_load_ms'/);
  assert.match(changesApi, /recordPerformanceMetric\("semantic_diff_load_ms"/);
  assert.match(analyticsApi, /recordPerformanceMetric\("runtime_overlay_load_ms"/);
});

test("assistant audit flow enforces redaction controls by default", () => {
  const missionControl = read("app/components/assistant/mission-control-panel.tsx");
  const redaction = read("app/lib/security-redaction.ts");
  const assistantApi = read("app/lib/api/assistant.ts");

  assert.match(missionControl, /ASSISTANT_SAFE_MODE_KEY/);
  assert.match(missionControl, /generateAssistantBrief/);
  assert.match(missionControl, /redactSensitiveText/);
  assert.match(missionControl, /Safe mode on \(redaction active\)/);
  assert.match(redaction, /REDACTION_TOKEN/);
  assert.match(redaction, /EMAIL_PATTERN/);
  assert.match(redaction, /API_KEY_PATTERN/);
  assert.ok(assistantApi.includes("/assistant/generate"));
});
