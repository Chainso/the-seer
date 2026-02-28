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

test("table primitive exposes Radix-style namespace API", () => {
  const table = read("app/components/ui/table.tsx");

  assert.match(table, /TableRoot\.displayName = "Table\.Root"/);
  assert.match(table, /TableHeader\.displayName = "Table\.Header"/);
  assert.match(table, /TableBody\.displayName = "Table\.Body"/);
  assert.match(table, /TableRow\.displayName = "Table\.Row"/);
  assert.match(table, /TableCell\.displayName = "Table\.Cell"/);
  assert.match(table, /TableColumnHeaderCell\.displayName = "Table\.ColumnHeaderCell"/);
  assert.match(table, /TableRowHeaderCell\.displayName = "Table\.RowHeaderCell"/);
  assert.match(table, /Root: TableRoot/);
  assert.match(table, /Header: TableHeader/);
  assert.match(table, /Body: TableBody/);
  assert.match(table, /Row: TableRow/);
  assert.match(table, /Cell: TableCell/);
  assert.match(table, /ColumnHeaderCell: TableColumnHeaderCell/);
  assert.match(table, /RowHeaderCell: TableRowHeaderCell/);
});

test("table consumers use namespace primitives and semantic header cells", () => {
  const actionList = read("app/components/ontology/lists/action-list.tsx");
  const eventList = read("app/components/ontology/lists/event-list.tsx");
  const objectList = read("app/components/ontology/lists/object-list.tsx");
  const triggerList = read("app/components/ontology/lists/trigger-list.tsx");
  const historyPanel = read("app/components/inspector/history-panel.tsx");

  for (const fileText of [
    actionList,
    eventList,
    objectList,
    triggerList,
    historyPanel,
  ]) {
    assert.match(fileText, /<Table\.Root/);
    assert.match(fileText, /<Table\.Header>/);
    assert.match(fileText, /<Table\.Body>/);
    assert.match(fileText, /<Table\.ColumnHeaderCell/);
    assert.match(fileText, /<Table\.RowHeaderCell/);
    assert.doesNotMatch(fileText, /<TableHead>/);
    assert.doesNotMatch(fileText, /<TableHeader>/);
    assert.doesNotMatch(fileText, /<TableBody>/);
    assert.doesNotMatch(fileText, /<TableRow>/);
    assert.doesNotMatch(fileText, /<TableCell/);
  }
});

test("empty-state table rows keep column spans aligned with headers", () => {
  const actionList = read("app/components/ontology/lists/action-list.tsx");
  const triggerList = read("app/components/ontology/lists/trigger-list.tsx");

  assert.match(actionList, /<Table\.Cell colSpan=\{5\}/);
  assert.match(triggerList, /<Table\.Cell colSpan=\{5\}/);
});
