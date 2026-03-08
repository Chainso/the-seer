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

const MIGRATED_PANEL_CONTRACTS = [
  {
    path: "app/components/inspector/history-panel.tsx",
    requiredPatterns: [
      /useOntologyDisplay/,
      /\.displayObjectType\(/,
      /\.displayFieldLabel\(/,
      /\.summarizeObjectRef\(/,
      /\.fieldKindForKey\(/,
      /\.operatorOptionsForField\(/,
      /profile:\s*"history"/,
    ],
  },
  {
    path: "app/components/inspector/process-insights-panel.tsx",
    requiredPatterns: [
      /useOntologyDisplay/,
      /\.displayObjectType\(/,
      /\.displayEventType\(/,
      /\.displayFieldLabel\(/,
      /\.fieldKindForKey\(/,
      /\.operatorOptionsForField\(/,
      /\.defaultOperatorForField\(/,
      /\.normalizeOperatorForField\(/,
      /profile:\s*"insights"/,
    ],
  },
  {
    path: "app/components/inspector/process-mining-panel.tsx",
    requiredPatterns: [
      /useOntologyDisplay/,
      /\.displayObjectType\(/,
      /\.displayEventType\(/,
      /catalog\.objectModels/,
    ],
  },
  {
    path: "app/components/inspector/use-object-history-display-data.ts",
    requiredPatterns: [
      /useOntologyDisplay/,
      /\.displayObjectType\(/,
      /\.displayEventType\(/,
      /\.displayFieldLabel\(/,
      /\.displayFieldValue\(/,
      /\.summarizeObjectRef\(/,
    ],
  },
];

const BANNED_PRETTY_HELPERS = [
  /\b(?:const|function)\s+prettyEventType\b/,
  /\b(?:const|function)\s+prettyFilterField\b/,
  /\b(?:const|function)\s+prettyFieldLabel\b/,
];

const IRI_FALLBACK_GUARDRAIL_PANELS = [
  "app/components/inspector/history-panel.tsx",
  "app/components/inspector/process-mining-panel.tsx",
  "app/components/inspector/use-object-history-display-data.ts",
];

test("migrated inspector panels keep using shared ontology-display APIs", () => {
  MIGRATED_PANEL_CONTRACTS.forEach((panel) => {
    const source = read(panel.path);
    assert.match(source, /from "@\/app\/lib\/ontology-display"/, `${panel.path} must import shared ontology-display module`);
    panel.requiredPatterns.forEach((pattern) => {
      assert.match(source, pattern, `${panel.path} must match ${pattern}`);
    });
  });
});

test("migrated inspector panels guard against reintroducing local display helpers", () => {
  MIGRATED_PANEL_CONTRACTS.forEach((panel) => {
    const source = read(panel.path);
    BANNED_PRETTY_HELPERS.forEach((pattern) => {
      assert.doesNotMatch(source, pattern, `${panel.path} must not redefine ${pattern}`);
    });
  });

  IRI_FALLBACK_GUARDRAIL_PANELS.forEach((panelPath) => {
    const source = read(panelPath);
    assert.doesNotMatch(source, /\b(?:const|function)\s+iriLocalName\b/, `${panelPath} must not re-declare iriLocalName`);
    assert.doesNotMatch(source, /\b(?:const|function)\s+ontologyNodeName\b/, `${panelPath} must not re-declare ontologyNodeName`);
    assert.doesNotMatch(
      source,
      /prophet:name[\s\S]{0,160}iriLocalName\(/,
      `${panelPath} must not implement local prophet:name -> iriLocalName fallback chains`
    );
  });
});
