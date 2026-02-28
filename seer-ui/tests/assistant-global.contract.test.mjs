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
  assert.match(appShell, /<GlobalAssistantLayer \/>/);
  assert.doesNotMatch(appShell, /GlobalAssistantCommandBar/);
});

test("assistant clients target canonical ai assistant endpoint", () => {
  const adapter = read("app/lib/api/assistant-chat.ts");
  const legacyAdapter = read("app/lib/api/assistant.ts");

  assert.match(adapter, /\/ai\/assistant\/chat/);
  assert.match(legacyAdapter, /postAssistantChat/);
  assert.doesNotMatch(legacyAdapter, /\/assistant\/generate/);
});
