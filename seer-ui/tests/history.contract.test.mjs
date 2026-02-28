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

test("inspector page exposes history tab with timeline panel", () => {
  const inspectorPage = read("app/inspector/page.tsx");
  const historyPanel = read("app/components/inspector/history-panel.tsx");
  const nav = read("app/components/layout/nav-sidebar.tsx");

  assert.match(inspectorPage, /TabsTrigger value="history"/);
  assert.match(inspectorPage, /TabsTrigger value="history">Object Store/);
  assert.match(historyPanel, /Object Store/);
  assert.match(historyPanel, /Live Objects/);
  assert.match(historyPanel, /Object Event History/);
  assert.match(nav, /name:\s*'Object Store'/);
  assert.match(nav, /href:\s*'\/inspector\/history'/);
});

test("history API client targets canonical history endpoints", () => {
  const historyApi = read("app/lib/api/history.ts");
  assert.match(historyApi, /\/history\/objects\/latest\/search/);
  assert.match(historyApi, /method:\s*'POST'/);
  assert.match(historyApi, /property_filters/);
  assert.match(historyApi, /\/history\/objects\/events/);
});

test("history panel consumes shared ontology display resolver contract", () => {
  const historyPanel = read("app/components/inspector/history-panel.tsx");
  assert.match(historyPanel, /useOntologyDisplay/);
  assert.match(historyPanel, /\.displayObjectType\(/);
  assert.match(historyPanel, /\.displayEventType\(/);
  assert.match(historyPanel, /\.displayFieldLabel\(/);
  assert.match(historyPanel, /\.displayFieldValue\(/);
  assert.match(historyPanel, /\.summarizeObjectRef\(/);
  assert.match(historyPanel, /\.summarizePayload\(/);
  assert.match(historyPanel, /\.fieldKindForKey\(/);
  assert.match(historyPanel, /\.operatorOptionsForField\(/);
  assert.match(historyPanel, /profile:\s*"history"/);
});
