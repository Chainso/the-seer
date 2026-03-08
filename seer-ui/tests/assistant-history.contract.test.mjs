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

test("assistant canvas dispatches object timeline artifacts to the shared history host", () => {
  const canvasPanel = read("app/components/assistant/assistant-canvas-panel.tsx");

  assert.match(canvasPanel, /AssistantObjectHistoryCanvas/);
  assert.match(canvasPanel, /data-assistant-object-history-canvas/);
  assert.match(canvasPanel, /parseObjectTimelineSnapshots/);
});

test("assistant history canvas reuses the shared object history display surface", () => {
  const assistantHistoryCanvas = read("app/components/assistant/assistant-object-history-canvas.tsx");

  assert.match(assistantHistoryCanvas, /ObjectHistoryDisplaySurface/);
  assert.match(assistantHistoryCanvas, /useObjectHistoryDisplayData/);
  assert.match(assistantHistoryCanvas, /listObjectEvents/);
  assert.match(assistantHistoryCanvas, /data-assistant-object-history-canvas/);
});
