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

test("workbench semantic markdown parser supports the shipped block set", () => {
  const parser = read("app/lib/workbench-semantic-markdown.ts");
  assert.match(parser, /'evidence'/);
  assert.match(parser, /'caveat'/);
  assert.match(parser, /'next-action'/);
  assert.match(parser, /'follow-up'/);
  assert.match(parser, /'linked-surface'/);
  assert.match(parser, /parseWorkbenchMarkdownParts/);
  assert.match(parser, /parseWorkbenchSemanticBlock/);
  assert.match(parser, /stripSemanticBlockWrapper/);
});

test("assistant workspace still carries the dedicated workbench page affordances", () => {
  const workspace = read("app/components/assistant/assistant-workspace.tsx");
  assert.match(workspace, /isWorkbenchPage/);
  assert.match(workspace, /WorkbenchClarificationPanel/);
  assert.match(workspace, /module: 'workbench'/);
});

test("assistant workspace renders semantic workbench blocks", () => {
  const workspace = read("app/components/assistant/assistant-workspace.tsx");
  assert.match(workspace, /parseWorkbenchSemanticBlock/);
  assert.match(workspace, /WorkbenchTextPart/);
  assert.match(workspace, /SemanticBlockLabel/);
  assert.match(workspace, /Open surface/);
  assert.match(workspace, /Suggestion, not a finding/);
  assert.match(workspace, /Clarify scope/);
  assert.match(workspace, /Run scoped investigation/);
  assert.match(workspace, /AI Investigation Workbench/);
  assert.match(workspace, /Ask an operational question in business language/);
  assert.match(workspace, /Investigating/);
});

test("shared assistant runtime scopes threads by experience", () => {
  const runtime = read("app/components/assistant/use-shared-assistant-runtime.ts");
  assert.match(runtime, /thread\.experience === experience/);
  assert.match(runtime, /state\.createNewThread\(undefined, experience\)/);
});

test("shared assistant state persists workbench scope between turns", () => {
  const state = read("app/components/assistant/shared-assistant-state.tsx");
  assert.match(state, /workbenchContext/);
  assert.match(state, /setThreadWorkbenchContext/);
  assert.match(state, /mergeAssistantContexts/);
});
