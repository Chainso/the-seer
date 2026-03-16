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

test("managed-agent inspector surfaces expose agent-first list, detail, editor, and nested run routes", () => {
  const listPage = read("app/inspector/managed-agents/page.tsx");
  const newPage = read("app/inspector/managed-agents/new/page.tsx");
  const detailPage = read("app/inspector/managed-agents/[managedAgentKey]/page.tsx");
  const editPage = read("app/inspector/managed-agents/[managedAgentKey]/edit/page.tsx");
  const runPage = read("app/inspector/managed-agents/[managedAgentKey]/runs/[executionId]/page.tsx");
  const listPanel = read("app/components/inspector/managed-agent-list-panel.tsx");
  const detailPanel = read("app/components/inspector/managed-agent-detail-panel.tsx");
  const editor = read("app/components/inspector/managed-agent-editor.tsx");
  const runsTable = read("app/components/inspector/managed-agent-runs-table.tsx");
  const detailsPanel = read("app/components/inspector/agentic-workflow-execution-details-panel.tsx");
  const nav = read("app/components/layout/nav-sidebar.tsx");

  assert.match(listPage, /ManagedAgentListPanel/);
  assert.match(newPage, /ManagedAgentEditor/);
  assert.match(detailPage, /ManagedAgentDetailPanel/);
  assert.match(editPage, /ManagedAgentEditor/);
  assert.match(runPage, /AgenticWorkflowExecutionDetailsPanel/);
  assert.match(listPanel, /New Managed Agent/);
  assert.match(listPanel, /Agent Catalog/);
  assert.match(listPanel, /View details/);
  assert.match(detailPanel, /TabsTrigger value="details"/);
  assert.match(detailPanel, /TabsTrigger value="runs"/);
  assert.match(detailPanel, /ManagedAgentRunsTable/);
  assert.match(editor, /Create Managed Agent/);
  assert.match(editor, /Output Event Schema/);
  assert.match(editor, /DialogTitle/);
  assert.match(runsTable, /Showing runs for/);
  assert.match(runsTable, /Open/);
  assert.match(detailsPanel, /backLabel = "Back to Runs"/);
  assert.match(detailsPanel, /buildExecutionHref/);
  assert.match(nav, /name:\s*'Managed Agents'/);
  assert.match(nav, /href:\s*'\/inspector\/managed-agents'/);
});

test("managed-agent API client targets authoring and execution endpoints", () => {
  const apiClient = read("app/lib/api/agentic-workflows.ts");
  const types = read("app/types/agentic-workflows.ts");
  const routes = read("app/lib/managed-agent-routes.ts");

  assert.match(apiClient, /listManagedAgents/);
  assert.match(apiClient, /getManagedAgent/);
  assert.match(apiClient, /getManagedAgentEditorCatalog/);
  assert.match(apiClient, /createManagedAgent/);
  assert.match(apiClient, /updateManagedAgent/);
  assert.match(apiClient, /\/agentic-workflows\/managed-agents/);
  assert.match(apiClient, /\/agentic-workflows\/executions\?/);
  assert.match(apiClient, /\/agentic-workflows\/executions\/\$\{executionId\}/);
  assert.match(apiClient, /after_ordinal/);
  assert.match(apiClient, /messages\/stream/);
  assert.match(routes, /buildManagedAgentRunHref/);
  assert.match(routes, /managedAgentKeyFromActionUri/);
  assert.match(types, /export interface ManagedAgentDetail/);
  assert.match(types, /export interface ManagedAgentUpsertRequest/);
  assert.match(types, /export interface AgenticWorkflowTranscriptMessage/);
  assert.match(types, /export type ManagedAgentFieldType/);
});
