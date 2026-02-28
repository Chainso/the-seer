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

  assert.match(inspectorPage, /TabsTrigger value="insights">Insights<\/TabsTrigger>/);
  assert.match(inspectorPage, /<InsightsPanel \/>/);
  assert.match(insightsRoute, /return <InsightsPanel \/>/);
});

test("insights panel uses canonical process mine and trace drill-down contracts", () => {
  const insightsPanel = read("app/components/inspector/insights-panel.tsx");
  const processApi = read("app/lib/api/process-mining.ts");
  const nav = read("app/components/layout/nav-sidebar.tsx");

  assert.match(insightsPanel, /mineProcess/);
  assert.match(insightsPanel, /getProcessTraceDrilldown/);
  assert.match(insightsPanel, /RunState = "idle" \| "queued" \| "running" \| "completed" \| "error"/);
  assert.match(processApi, /max_events/);
  assert.match(processApi, /max_relations/);
  assert.match(processApi, /max_traces_per_handle/);
  assert.match(nav, /name:\s*'Insights'/);
  assert.match(nav, /href:\s*'\/inspector\/insights'/);
});
