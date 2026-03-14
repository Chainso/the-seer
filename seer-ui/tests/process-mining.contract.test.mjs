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

test("ocdfg graph adapter rejects invalid edge references instead of falling back", () => {
  const processApi = read("app/lib/api/process-mining.ts");
  const layout = read("app/lib/process-mining/ocdfg-layout.ts");

  assert.match(processApi, /assertOcdfgGraphIntegrity/);
  assert.match(processApi, /Invalid OC-DFG response: edge/);
  assert.match(layout, /Invalid OC-DFG layout input: edge/);
  assert.doesNotMatch(layout, /sourcePort\?\.right \?\? edge\.source/);
  assert.doesNotMatch(layout, /targetPort\?\.left \?\? edge\.target/);
});
