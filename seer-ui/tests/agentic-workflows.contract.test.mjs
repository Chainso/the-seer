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

test("agentic workflow inspector surfaces expose dedicated execution list and detail routes", () => {
  const listPage = read("app/inspector/agentic-workflows/page.tsx");
  const detailPage = read("app/inspector/agentic-workflows/[executionId]/page.tsx");
  const listPanel = read("app/components/inspector/agentic-workflow-execution-panel.tsx");
  const detailsPanel = read("app/components/inspector/agentic-workflow-execution-details-panel.tsx");
  const nav = read("app/components/layout/nav-sidebar.tsx");

  assert.match(listPage, /AgenticWorkflowExecutionPanel/);
  assert.match(detailPage, /AgenticWorkflowExecutionDetailsPanel/);
  assert.match(listPanel, /matching runs/);
  assert.match(listPanel, /Workflow capability/);
  assert.match(listPanel, /buildExecutionHref/);
  assert.match(listPanel, /Open run/);
  assert.match(listPanel, /\/inspector\/agentic-workflows\/\$\{executionId\}/);
  assert.doesNotMatch(listPanel, /Browse managed workflow runs/);
  assert.match(detailsPanel, /Back to Runs/);
  assert.match(detailsPanel, /Transcript/);
  assert.match(detailsPanel, /Related Actions/);
  assert.match(detailsPanel, /Produced Events/);
  assert.doesNotMatch(detailsPanel, /Review persisted transcript history/);
  assert.match(nav, /name:\s*'Workflow Runs'/);
  assert.match(nav, /href:\s*'\/inspector\/agentic-workflows'/);
});

test("agentic workflow API client targets dedicated execution and transcript endpoints", () => {
  const apiClient = read("app/lib/api/agentic-workflows.ts");
  const types = read("app/types/agentic-workflows.ts");

  assert.match(apiClient, /\/agentic-workflows\/executions\?/);
  assert.match(apiClient, /\/agentic-workflows\/executions\/\$\{executionId\}/);
  assert.match(apiClient, /listRegisteredAgenticWorkflows/);
  assert.match(apiClient, /queryOntologySelect/);
  assert.match(apiClient, /after_ordinal/);
  assert.match(apiClient, /messages\/stream/);
  assert.match(apiClient, /case 'message'/);
  assert.match(apiClient, /case 'terminal'/);
  assert.match(types, /export interface AgenticWorkflowTranscriptMessage/);
  assert.match(types, /export interface AgenticWorkflowTranscriptSnapshotEvent/);
  assert.doesNotMatch(types, /user_id:\s*string;\s*status:/);
});
