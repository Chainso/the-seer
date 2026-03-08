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

test("assistant canvas dispatches RCA artifacts to the shared RCA host", () => {
  const canvasPanel = read("app/components/assistant/assistant-canvas-panel.tsx");

  assert.match(canvasPanel, /AssistantRootCauseCanvas/);
  assert.match(canvasPanel, /data-assistant-rca-canvas/);
  assert.match(canvasPanel, /parseRcaRunContract/);
});

test("assistant RCA canvas reuses the shared root-cause results surface", () => {
  const assistantRcaCanvas = read("app/components/assistant/assistant-root-cause-canvas.tsx");

  assert.match(assistantRcaCanvas, /RootCauseResultsSurface/);
  assert.match(assistantRcaCanvas, /getRootCauseEvidence/);
  assert.match(assistantRcaCanvas, /assistRootCauseInterpret/);
  assert.match(assistantRcaCanvas, /data-assistant-rca-canvas/);
});
