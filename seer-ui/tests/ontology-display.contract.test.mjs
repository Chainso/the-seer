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
const edgePresentationModule = loadTsModule(
  path.join(root, "app/components/ontology/ontology-edge-presentation.ts")
);
const referenceEdgeModule = loadTsModule(path.join(root, "app/components/ontology/graph-reference-edges.ts"));

const { buildOntologyDisplayCatalog, tokenVariants } = catalogModule;
const { createOntologyDisplayResolver } = resolverModule;
const { getOntologyEdgePresentation } = edgePresentationModule;
const { buildReferenceEdges } = referenceEdgeModule;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function buildFixtureGraph() {
  const stateOptions = [
    { value: "PendingPayment", label: "Pending Approval" },
    { value: "Approved", label: "Approved" },
  ];
  return {
    nodes: [
      {
        uri: "http://example.com/obj_order",
        label: "ObjectModel",
        properties: {
          "prophet:name": "Order",
          stateCarrierFieldKey: "status",
          stateCarrierPropertyUri: "http://example.com/prop_status",
          initialStateValue: "PendingPayment",
          stateOptions,
        },
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
        uri: "http://example.com/prop_status",
        label: "PropertyDefinition",
        properties: {
          fieldKey: "status",
          "prophet:name": "Status",
          isStateCarrier: true,
          initialStateValue: "PendingPayment",
          stateOptions,
        },
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
      { fromUri: "http://example.com/obj_order", toUri: "http://example.com/prop_status", type: "hasProperty" },
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
  assert.equal(resolver.displayFieldLabel("status", { objectType: "order" }), "Status");
  assert.equal(
    resolver.displayFieldLabel("event.present.OrderCreated", { objectType: "order" }),
    "Event present • Order Created"
  );
  assert.equal(
    resolver.displayFieldValue("status", "PendingPayment", { objectType: "order" }),
    "Pending Approval"
  );
  assert.equal(
    resolver.displayFieldValue("from_state", "PendingPayment", { objectType: "order" }),
    "Pending Approval"
  );
  assert.equal(
    resolver.summarizeObjectRef({ customer: "ACME", order_id: "SO-1", ignored: "x" }, { objectType: "order" }),
    "Customer · ACME | Order ID · SO-1"
  );
  assert.equal(
    resolver.summarizePayload(
      { status: "PendingPayment", quantity: 3, customer: "ACME", metadata: { nested: true } },
      { objectType: "order" }
    ),
    "Status · Pending Approval | Quantity · 3 | Customer · ACME"
  );
});

test("resolver removes hard-coded alias rewrites and keeps state-carrier token mapping contracts", () => {
  const resolver = buildResolver();

  assert.equal(resolver.displayObjectType("sales order"), "sales order");
  assert.equal(
    resolver.displayFieldLabel("sales_order_number", { objectType: "order" }),
    "sales_order_number"
  );
  assert.equal(
    resolver.displayFieldValue("status", "PendingPayment", { objectType: "order" }),
    "Pending Approval"
  );
  assert.equal(
    resolver.displayFieldValue("from_state", "PendingPayment", { objectType: "order" }),
    "Pending Approval"
  );
  assert.ok(!tokenVariants("order").includes("salesorder"));
  assert.ok(!tokenVariants("sales_order_total").includes("order_total"));
});

test("catalog exposes state-carrier metadata on object models", () => {
  const catalog = buildOntologyDisplayCatalog(buildFixtureGraph());
  const order = catalog.objectModelByUri.get("http://example.com/obj_order");

  assert.ok(order);
  assert.equal(order.stateFilterFieldKey, "status");
  assert.equal(order.stateCarrierPropertyUri, "http://example.com/prop_status");
  assert.equal(order.initialStateValue, "PendingPayment");
  assert.equal(
    JSON.stringify(order.stateFilterOptions),
    JSON.stringify([
      { value: "Approved", label: "Approved" },
      { value: "PendingPayment", label: "Pending Approval" },
    ])
  );
});

test("catalog omits legacy alias rewrite tables", () => {
  const catalogSource = read("app/lib/ontology-display/catalog.ts");

  assert.doesNotMatch(catalogSource, /MODEL_ALIAS_REWRITES/);
  assert.doesNotMatch(catalogSource, /FIELD_ALIAS_REWRITES/);
});

test("explorer taxonomy stays on live Prophet concepts without lifecycle relabeling", () => {
  const explorerSource = read("app/components/ontology/ontology-explorer-tabs.tsx");
  const graphSource = read("app/components/ontology/ontology-graph.tsx");

  assert.match(explorerSource, /labels:\s*\['ObjectModel', 'Action', 'Event', 'EventTrigger'\]/);
  assert.match(explorerSource, /const RELATIONSHIP_SCOPE_LABEL: Record<RelationshipScope, string> = \{\s*automation:/);
  assert.doesNotMatch(explorerSource, /structure:\s*'Structure'/);
  assert.doesNotMatch(explorerSource, /lifecycleLabelMode:\s*['"]explicit['"]/);
  assert.doesNotMatch(explorerSource, /\b(state|process|workflow|signal)\b/i);
  assert.match(explorerSource, /displayNodeName=\{displayNameForNode\}/);
  assert.match(explorerSource, /buildReferenceEdges/);
  assert.match(explorerSource, /listOntologyEdgePresentations/);
  assert.match(explorerSource, /'listensTo', 'invokes', 'triggers', 'producesEvent'/);
  assert.doesNotMatch(explorerSource, /deriveAuthoringReferenceEdges/);
  assert.match(explorerSource, /return scope \? relationshipFilters\[scope\] : true/);
  assert.match(graphSource, /'ObjectModel',\s*'Action',\s*'Event',\s*'EventTrigger'/);
  assert.match(graphSource, /displayNodeName\?:\s*\(node:\s*OntologyGraphNode\)\s*=>\s*string/);
  assert.match(graphSource, /displayNodeName\?\.\(node\)/);
  assert.match(graphSource, /getOntologyEdgePresentation\(edge\.type\)/);
  assert.match(graphSource, /ontology-edge-presentation/);
  assert.doesNotMatch(graphSource, /EdgeLabelRenderer/);
  assert.doesNotMatch(graphSource, /label:\s*prettifyEdgeLabel\(edge\.type\)/);
  assert.doesNotMatch(graphSource, /\b(process|workflow|signal)\b/i);
});

test("shared edge presentation utility keeps automation edge types visually distinct", () => {
  const produces = getOntologyEdgePresentation("producesEvent");
  const triggers = getOntologyEdgePresentation("triggers");
  const listens = getOntologyEdgePresentation("listensTo");
  const invokes = getOntologyEdgePresentation("invokes");
  const references = getOntologyEdgePresentation("referencesObjectModel");

  assert.equal(produces.label, "Produces Event");
  assert.equal(produces.stroke, "var(--graph-edge-transition)");
  assert.equal(produces.strokeDasharray, undefined);

  assert.equal(triggers.stroke, "var(--graph-edge-transition)");
  assert.equal(triggers.strokeDasharray, "10 4");

  assert.equal(listens.strokeDasharray, "2 6");
  assert.equal(invokes.strokeDasharray, "1 5");

  assert.equal(references.stroke, "var(--graph-edge-reference)");
  assert.equal(references.strokeDasharray, "6 4");
});

test("shared reference-edge helper derives action links through produced event output schemas", () => {
  const graph = {
    nodes: [
      { uri: "urn:act:ship-order", label: "Action", properties: {} },
      { uri: "urn:input:ship-order", label: "ActionInput", properties: {} },
      { uri: "urn:event:order-shipped", label: "Event", properties: {} },
      { uri: "urn:model:order", label: "ObjectModel", properties: {} },
      { uri: "urn:prop:event-payload", label: "PropertyDefinition", properties: {} },
      { uri: "urn:type:shipment-payload", label: "StructType", properties: {} },
      { uri: "urn:prop:orders", label: "PropertyDefinition", properties: {} },
      { uri: "urn:type:order-list", label: "ListType", properties: {} },
      { uri: "urn:type:order-ref", label: "ObjectReference", properties: {} },
    ],
    edges: [
      { fromUri: "urn:act:ship-order", toUri: "urn:input:ship-order", type: "acceptsInput" },
      { fromUri: "urn:act:ship-order", toUri: "urn:event:order-shipped", type: "producesEvent" },
      { fromUri: "urn:event:order-shipped", toUri: "urn:prop:event-payload", type: "hasProperty" },
      { fromUri: "urn:prop:event-payload", toUri: "urn:type:shipment-payload", type: "valueType" },
      { fromUri: "urn:type:shipment-payload", toUri: "urn:prop:orders", type: "hasProperty" },
      { fromUri: "urn:prop:orders", toUri: "urn:type:order-list", type: "valueType" },
      { fromUri: "urn:type:order-list", toUri: "urn:type:order-ref", type: "itemType" },
      { fromUri: "urn:type:order-ref", toUri: "urn:model:order", type: "referencesObjectModel" },
    ],
  };

  const references = buildReferenceEdges(graph.nodes, graph.edges);
  const serialized = references.map((edge) => `${edge.fromUri}|${edge.type}|${edge.toUri}`).sort();

  assert.ok(
    serialized.includes("urn:act:ship-order|referencesObjectModel|urn:model:order"),
    "action should inherit object-model references from its produced event schema"
  );
  assert.ok(
    serialized.includes("urn:event:order-shipped|referencesObjectModel|urn:model:order"),
    "event should retain its own derived object-model reference"
  );
});

test("ontology page host and assistant canvas host share the explorer display surface", () => {
  const pageSource = read("app/ontology/[tab]/page.tsx");
  const assistantHostSource = read("app/components/assistant/assistant-ontology-canvas.tsx");
  const explorerSource = read("app/components/ontology/ontology-explorer-tabs.tsx");

  assert.match(pageSource, /OntologyExplorerTabs/);
  assert.match(pageSource, /activeTab=\{activeTab\}/);
  assert.match(pageSource, /onTabChange=\{handleTabChange\}/);

  assert.match(assistantHostSource, /OntologyExplorerTabs/);
  assert.match(assistantHostSource, /deriveFocusNeighborhoodUris/);
  assert.match(assistantHostSource, /scopedVisibleConceptUris\?\.join\("\|"\) \|\| "auto"/);
  assert.match(assistantHostSource, /initialTab=\{initialTab \|\| undefined\}/);
  assert.match(assistantHostSource, /initialConceptUri=\{focusConceptUri \|\| undefined\}/);
  assert.match(assistantHostSource, /visibleConceptUris=\{scopedVisibleConceptUris\}/);
  assert.match(assistantHostSource, /initialFocusNeighborhoodOnly=\{!scopedVisibleConceptUris && Boolean\(focusConceptUri\)\}/);

  assert.match(explorerSource, /initialTab\?: string/);
  assert.match(explorerSource, /visibleConceptUris\?: string\[] \| null/);
  assert.match(explorerSource, /initialFocusNeighborhoodOnly\?: boolean/);
  assert.match(explorerSource, /useState<ExplorerTab>\(\s*initialTab && initialTab in TAB_CONFIG/);
  assert.match(explorerSource, /const \[focusNeighborhoodOnly, setFocusNeighborhoodOnly\] = useState\(\s*initialFocusNeighborhoodOnly/);
  assert.match(explorerSource, /visibleConceptUris\.filter/);
});

test("history details panel keeps object-local lifecycle naming in plain/default mode", () => {
  const historySource = read("app/components/inspector/history-live-objects-panel.tsx");
  const detailsSource = read("app/components/inspector/use-object-history-display-data.ts");
  const resolver = buildResolver();

  assert.doesNotMatch(historySource, /lifecycleLabelMode:\s*['"]explicit['"]/);
  assert.match(detailsSource, /displayFieldValue\(/);
  assert.equal(
    resolver.displayFieldValue("from_state", "PendingPayment", { objectType: "order" }),
    "Pending Approval"
  );
  assert.equal(
    resolver.displayFieldValue("to_state", "Approved", { objectType: "order" }),
    "Approved"
  );
});

test("resolver keeps lifecycle concept labels plain by default", () => {
  const resolver = buildResolver();

  assert.equal(
    resolver.displayConcept("http://example.com/evt_order_created", { conceptKind: "Event" }),
    "Order Created"
  );
  assert.equal(
    resolver.displayNode({
      uri: "http://example.com/evt_order_created",
      label: "Event",
      properties: { "prophet:name": "Order Created" },
    }),
    "Order Created"
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
