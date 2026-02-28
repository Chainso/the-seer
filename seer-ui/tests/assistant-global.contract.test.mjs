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
});

test("assistant route uses the shared assistant workspace", () => {
  const assistantPage = read("app/assistant/page.tsx");
  assert.match(assistantPage, /AssistantPageWorkspace/);
  assert.doesNotMatch(assistantPage, /MissionControlPanel/);
});

test("shared assistant state uses a single canonical storage model", () => {
  const sharedState = read("app/components/assistant/shared-assistant-state.tsx");
  assert.match(sharedState, /seer_assistant_threads_v3/);
  assert.doesNotMatch(sharedState, /seer_global_assistant_threads_v1/);
  assert.doesNotMatch(sharedState, /seer_assistant_conversations_v2/);
});
