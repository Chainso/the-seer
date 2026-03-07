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

test("app shell mounts global assistant layer outside route pages", () => {
  const appShell = read("app/components/layout/app-shell.tsx");
  assert.match(appShell, /GlobalAssistantLayer/);
  assert.match(appShell, /SharedAssistantStateProvider/);
  assert.match(appShell, /<GlobalAssistantLayer \/>/);
  assert.doesNotMatch(appShell, /GlobalAssistantCommandBar/);
});

test("assistant clients target canonical ai assistant endpoint", () => {
  const adapter = read("app/lib/api/assistant-chat.ts");
  assert.match(adapter, /\/ai\/assistant\/chat/);
  assert.match(adapter, /text\/event-stream/);
  assert.match(adapter, /postAssistantChatStream/);
  assert.match(adapter, /completion_messages/);
  assert.doesNotMatch(adapter, /messages:\s*AssistantChatMessage\[\]/);
  assert.match(adapter, /assistant_delta/);
  assert.match(adapter, /case 'final'/);
});

test("workbench client targets dedicated ai workbench endpoint", () => {
  const adapter = read("app/lib/api/workbench.ts");
  assert.match(adapter, /\/ai\/workbench\/chat/);
  assert.match(adapter, /text\/event-stream/);
  assert.match(adapter, /postWorkbenchChatStream/);
  assert.match(adapter, /investigation_status/);
  assert.match(adapter, /linked_surface_hint/);
  assert.match(adapter, /answer_markdown/);
});

test("assistant route uses the shared assistant workspace", () => {
  const assistantPage = read("app/assistant/page.tsx");
  assert.match(assistantPage, /AssistantPageWorkspace/);
  assert.doesNotMatch(assistantPage, /MissionControlPanel/);
  assert.doesNotMatch(assistantPage, /Loading workbench/);
});

test("assistant page workspace uses the canonical assistant experience", () => {
  const workspace = read("app/components/assistant/assistant-page-workspace.tsx");
  assert.match(workspace, /experience="assistant"/);
  assert.match(workspace, /moduleName="assistant"/);
  assert.doesNotMatch(workspace, /experience="workbench"/);
});

test("shared assistant state uses a single canonical storage model", () => {
  const sharedState = read("app/components/assistant/shared-assistant-state.tsx");
  assert.match(sharedState, /seer_assistant_threads_v3/);
  assert.match(sharedState, /postAssistantChatStream/);
  assert.match(sharedState, /postWorkbenchChatStream/);
  assert.match(sharedState, /onAssistantDelta/);
  assert.match(sharedState, /completion_messages/);
  assert.match(sharedState, /investigation_id/);
  assert.match(sharedState, /experience:/);
  assert.doesNotMatch(sharedState, /toAssistantChatMessages/);
  assert.match(sharedState, /cancelThread/);
  assert.doesNotMatch(sharedState, /postAssistantChat\(/);
  assert.doesNotMatch(sharedState, /seer_global_assistant_threads_v1/);
  assert.doesNotMatch(sharedState, /seer_assistant_conversations_v2/);
});

test("shared assistant runtime wires cancel controls to thread abort", () => {
  const runtime = read("app/components/assistant/use-shared-assistant-runtime.ts");
  assert.match(runtime, /onCancel/);
  assert.match(runtime, /cancelThread/);
  assert.match(runtime, /activeCanvasState/);
});

test("assistant workspace consumes canvas state in the page shell", () => {
  const workspace = read("app/components/assistant/assistant-workspace.tsx");
  assert.match(workspace, /data-assistant-page-shell/);
  assert.match(workspace, /data-assistant-page-canvas/);
  assert.match(workspace, /AssistantCanvasPanel/);
  assert.match(workspace, /activeCanvasState/);
  assert.doesNotMatch(workspace, /WorkbenchClarificationPanel/);
  assert.doesNotMatch(workspace, /AI Investigation Workbench/);
  assert.doesNotMatch(workspace, /Primary Investigation Surface/);
});

test("assistant canvas state derives from persisted completion messages", () => {
  const helper = read("app/lib/assistant-canvas-state.ts");
  assert.match(helper, /deriveCanvasStateFromCompletionMessages/);
  assert.match(helper, /canvas_action/);
  assert.match(helper, /artifact_id/);
  assert.match(helper, /action === 'close'/);
  assert.match(helper, /action: 'close'/);
  assert.match(helper, /artifacts\.set/);
});

test("shared assistant state exposes thread canvas derivation", () => {
  const sharedState = read("app/components/assistant/shared-assistant-state.tsx");
  assert.match(sharedState, /getThreadCanvasState/);
  assert.match(sharedState, /deriveCanvasStateFromCompletionMessages/);
});
