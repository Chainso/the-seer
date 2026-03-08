import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const moduleCache = new Map();

function resolveTsSpecifier(fromFile, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const fromDir = path.dirname(fromFile);
  const base = path.resolve(fromDir, specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function loadTsModule(modulePath) {
  const absolutePath = path.resolve(modulePath);
  if (moduleCache.has(absolutePath)) {
    return moduleCache.get(absolutePath);
  }

  const source = fs.readFileSync(absolutePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: absolutePath,
  });

  const cjsModule = { exports: {} };
  moduleCache.set(absolutePath, cjsModule.exports);

  const localRequire = (specifier) => {
    const resolvedTsPath = resolveTsSpecifier(absolutePath, specifier);
    if (resolvedTsPath) {
      return loadTsModule(resolvedTsPath);
    }
    return require(specifier);
  };

  const context = {
    module: cjsModule,
    exports: cjsModule.exports,
    require: localRequire,
    __filename: absolutePath,
    __dirname: path.dirname(absolutePath),
    process,
    console,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Date,
    JSON,
    RegExp,
    Error,
  };

  vm.runInNewContext(compiled.outputText, context, { filename: absolutePath });
  moduleCache.set(absolutePath, cjsModule.exports);
  return cjsModule.exports;
}

const catalogModule = loadTsModule(path.join(root, "app/lib/ontology-display/catalog.ts"));
const resolverModule = loadTsModule(path.join(root, "app/lib/ontology-display/resolver.ts"));

const { buildOntologyDisplayCatalog, tokenVariants } = catalogModule;
const { createOntologyDisplayResolver } = resolverModule;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function buildFixtureGraph() {
  return {
    nodes: [
      {
        uri: "http://example.com/obj_order",
        label: "ObjectModel",
        properties: { "prophet:name": "Order" },
      },
      {
        uri: "http://example.com/state_order_pending",
        label: "State",
        properties: { "prophet:name": "Pending Approval" },
      },
      {
        uri: "http://example.com/state_order_approved",
        label: "State",
        properties: { "prophet:name": "Approved" },
      },
      {
        uri: "http://example.com/trans_order_approve",
        label: "Transition",
        properties: { "prophet:name": "Approve" },
      },
      {
        uri: "http://example.com/prop_customer",
        label: "PropertyDefinition",
        properties: { fieldKey: "customer", "prophet:name": "Customer" },
      },
      {
        uri: "http://example.com/prop_order",
        label: "PropertyDefinition",
        properties: { fieldKey: "order", "prophet:name": "Order" },
      },
      {
        uri: "http://example.com/prop_order_number",
        label: "PropertyDefinition",
        properties: { fieldKey: "order_number", "prophet:name": "Order Number" },
      },
      {
        uri: "http://example.com/prop_quantity",
        label: "PropertyDefinition",
        properties: { fieldKey: "quantity", "prophet:name": "Quantity" },
      },
      {
        uri: "http://example.com/prop_state",
        label: "PropertyDefinition",
        properties: { fieldKey: "state", "prophet:name": "State" },
      },
      {
        uri: "http://example.com/evt_order_created",
        label: "Event",
        properties: { "prophet:name": "Order Created" },
      },
      {
        uri: "http://example.com/prop_source_system",
        label: "PropertyDefinition",
        properties: { fieldKey: "source_system", "prophet:name": "Source System" },
      },
    ],
    edges: [
      { fromUri: "http://example.com/obj_order", toUri: "http://example.com/prop_customer", type: "hasProperty" },
      { fromUri: "http://example.com/obj_order", toUri: "http://example.com/prop_order", type: "hasProperty" },
      {
        fromUri: "http://example.com/obj_order",
        toUri: "http://example.com/prop_order_number",
        type: "hasProperty",
      },
      { fromUri: "http://example.com/obj_order", toUri: "http://example.com/prop_quantity", type: "hasProperty" },
      { fromUri: "http://example.com/obj_order", toUri: "http://example.com/prop_state", type: "hasProperty" },
      {
        fromUri: "http://example.com/obj_order",
        toUri: "http://example.com/state_order_pending",
        type: "hasPossibleState",
      },
      {
        fromUri: "http://example.com/obj_order",
        toUri: "http://example.com/state_order_approved",
        type: "hasPossibleState",
      },
      {
        fromUri: "http://example.com/trans_order_approve",
        toUri: "http://example.com/obj_order",
        type: "transitionOf",
      },
      {
        fromUri: "http://example.com/trans_order_approve",
        toUri: "http://example.com/state_order_pending",
        type: "fromState",
      },
      {
        fromUri: "http://example.com/trans_order_approve",
        toUri: "http://example.com/state_order_approved",
        type: "toState",
      },
      {
        fromUri: "http://example.com/prop_quantity",
        toUri: "http://www.w3.org/2001/XMLSchema#integer",
        type: "valueType",
      },
      { fromUri: "http://example.com/evt_order_created", toUri: "http://example.com/prop_source_system", type: "hasProperty" },
    ],
  };
}

function buildResolver() {
  const catalog = buildOntologyDisplayCatalog(buildFixtureGraph());
  return createOntologyDisplayResolver(catalog);
}

test("ontology display module exposes phase-1 entrypoints", () => {
  const indexSource = read("app/lib/ontology-display/index.ts");
  const hookSource = read("app/lib/ontology-display/use-ontology-display.ts");

  assert.match(indexSource, /export \* from "\.\/catalog"/);
  assert.match(indexSource, /export \* from "\.\/resolver"/);
  assert.match(indexSource, /export \* from "\.\/use-ontology-display"/);
  assert.match(hookSource, /buildOntologyDisplayCatalog/);
  assert.match(hookSource, /createOntologyDisplayResolver/);
});

test("resolver applies ontology-first object and event display labels", () => {
  const resolver = buildResolver();

  assert.equal(resolver.displayObjectType("order"), "Order");
  assert.equal(resolver.displayEventType("OrderCreated"), "Order Created");
  assert.equal(
    resolver.displayEventType("order.cancelled", { fallbackObjectType: "order" }),
    "Order cancelled"
  );
});

test("resolver centralizes field label, state value, and summary rendering", () => {
  const resolver = buildResolver();

  assert.equal(resolver.displayFieldLabel("customer_id", { objectType: "order" }), "Customer ID");
  assert.equal(resolver.displayFieldLabel("state", { objectType: "order" }), "State");
  assert.equal(
    resolver.displayFieldLabel("event.present.OrderCreated", { objectType: "order" }),
    "Event present • Order Created"
  );
  assert.equal(
    resolver.displayFieldValue("state", "pending", { objectType: "order" }),
    "Pending Approval"
  );
  assert.equal(
    resolver.displayFieldValue("from_state", "pending", { objectType: "order" }),
    "Pending Approval"
  );
  assert.equal(
    resolver.summarizeObjectRef({ customer: "ACME", order_id: "SO-1", ignored: "x" }, { objectType: "order" }),
    "Customer · ACME | Order ID · SO-1"
  );
  assert.equal(
    resolver.summarizePayload(
      { state: "pending", quantity: 3, customer: "ACME", metadata: { nested: true } },
      { objectType: "order" }
    ),
    "State · Pending Approval | Quantity · 3 | Customer · ACME"
  );
});

test("resolver removes hard-coded alias rewrites and keeps state token mapping contracts", () => {
  const resolver = buildResolver();

  assert.equal(resolver.displayObjectType("sales order"), "sales order");
  assert.equal(
    resolver.displayFieldLabel("sales_order_number", { objectType: "order" }),
    "sales_order_number"
  );
  assert.equal(
    resolver.displayFieldValue("state", "state_order_pending", { objectType: "order" }),
    "Pending Approval"
  );
  assert.equal(
    resolver.displayFieldValue("from_state", "order_pending", { objectType: "order" }),
    "Pending Approval"
  );
  assert.ok(!tokenVariants("order").includes("salesorder"));
  assert.ok(!tokenVariants("sales_order_total").includes("order_total"));
});

test("catalog omits legacy alias rewrite tables", () => {
  const catalogSource = read("app/lib/ontology-display/catalog.ts");

  assert.doesNotMatch(catalogSource, /MODEL_ALIAS_REWRITES/);
  assert.doesNotMatch(catalogSource, /FIELD_ALIAS_REWRITES/);
});

test("explorer opts into explicit lifecycle naming in catalog, inspector, and graph map", () => {
  const explorerSource = read("app/components/ontology/ontology-explorer-tabs.tsx");
  const graphSource = read("app/components/ontology/ontology-graph.tsx");

  assert.match(explorerSource, /displayNode\(\s*node,\s*\{\s*lifecycleLabelMode:\s*'explicit'\s*\}\s*\)/);
  assert.match(explorerSource, /displayConcept\(\s*uri,\s*\{\s*lifecycleLabelMode:\s*'explicit'\s*\}\s*\)/);
  assert.match(explorerSource, /displayNodeName=\{displayNameForNode\}/);
  assert.match(graphSource, /displayNodeName\?:\s*\(node:\s*OntologyGraphNode\)\s*=>\s*string/);
  assert.match(graphSource, /displayNodeName\?\.\(node\)/);
});

test("ontology page host and assistant canvas host share the explorer display surface", () => {
  const pageSource = read("app/ontology/[tab]/page.tsx");
  const assistantHostSource = read("app/components/assistant/assistant-ontology-canvas.tsx");
  const explorerSource = read("app/components/ontology/ontology-explorer-tabs.tsx");

  assert.match(pageSource, /OntologyExplorerTabs/);
  assert.match(pageSource, /activeTab=\{activeTab\}/);
  assert.match(pageSource, /onTabChange=\{handleTabChange\}/);

  assert.match(assistantHostSource, /OntologyExplorerTabs/);
  assert.match(assistantHostSource, /key=\{`\$\{initialTab \|\| "overview"\}:\$\{focusConceptUri \|\| "all"\}`\}/);
  assert.match(assistantHostSource, /initialTab=\{initialTab \|\| undefined\}/);
  assert.match(assistantHostSource, /initialConceptUri=\{focusConceptUri \|\| undefined\}/);

  assert.match(explorerSource, /initialTab\?: string/);
  assert.match(explorerSource, /useState<ExplorerTab>\(\s*initialTab && initialTab in TAB_CONFIG/);
});

test("history details panel keeps object-local lifecycle naming in plain/default mode", () => {
  const historySource = read("app/components/inspector/history-panel.tsx");
  const detailsSource = read("app/components/inspector/use-object-history-display-data.ts");
  const resolver = buildResolver();

  assert.doesNotMatch(historySource, /lifecycleLabelMode:\s*['"]explicit['"]/);
  assert.match(detailsSource, /displayFieldValue\(/);
  assert.equal(
    resolver.displayFieldValue("from_state", "pending", { objectType: "order" }),
    "Pending Approval"
  );
  assert.equal(
    resolver.displayFieldValue("to_state", "approved", { objectType: "order" }),
    "Approved"
  );
});

test("resolver formats lifecycle concept labels in explicit mode", () => {
  const resolver = buildResolver();

  assert.equal(
    resolver.displayConcept("http://example.com/state_order_pending", {
      conceptKind: "State",
      lifecycleLabelMode: "explicit",
    }),
    "Order Pending Approval"
  );
  assert.equal(
    resolver.displayConcept("http://example.com/trans_order_approve", {
      conceptKind: "Transition",
      lifecycleLabelMode: "explicit",
    }),
    "Approve Order"
  );
  assert.equal(
    resolver.displayNode(
      {
        uri: "http://example.com/state_order_pending",
        label: "State",
        properties: { "prophet:name": "Pending Approval" },
      },
      { lifecycleLabelMode: "explicit" }
    ),
    "Order Pending Approval"
  );
  assert.equal(
    resolver.displayNode(
      {
        uri: "http://example.com/trans_order_approve",
        label: "Transition",
        properties: { "prophet:name": "Approve" },
      },
      { lifecycleLabelMode: "explicit" }
    ),
    "Approve Order"
  );
});

test("resolver keeps lifecycle concept labels plain by default", () => {
  const resolver = buildResolver();

  assert.equal(
    resolver.displayConcept("http://example.com/state_order_pending", { conceptKind: "State" }),
    "Pending Approval"
  );
  assert.equal(
    resolver.displayConcept("http://example.com/trans_order_approve", { conceptKind: "Transition" }),
    "Approve"
  );
  assert.equal(
    resolver.displayNode({
      uri: "http://example.com/state_order_pending",
      label: "State",
      properties: { "prophet:name": "Pending Approval" },
    }),
    "Pending Approval"
  );
});

test("resolver centralizes field kind and operator compatibility rules", () => {
  const resolver = buildResolver();

  assert.equal(resolver.fieldKindForKey("quantity", { objectType: "order" }), "number");
  assert.equal(resolver.fieldKindForKey("event.present.OrderCreated"), "boolean");
  assert.equal(resolver.fieldKindForKey("event.count.OrderCreated"), "count");

  assert.equal(
    resolver
      .operatorOptionsForField("event.present.OrderCreated", { profile: "history" })
      .map((option) => option.value)
      .join(","),
    "eq"
  );
  assert.equal(
    resolver
      .operatorOptionsForField("event.count.OrderCreated", { profile: "insights" })
      .map((option) => option.value)
      .join(","),
    "eq,ne,gt,gte,lt,lte"
  );
  assert.equal(
    resolver.normalizeOperatorForField("event.present.OrderCreated", "contains", {
      profile: "history",
    }),
    "eq"
  );
});
