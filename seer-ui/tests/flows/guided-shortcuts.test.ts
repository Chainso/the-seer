import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGuidedInvestigationShortcutHref,
  buildModuleGuidedShortcuts,
} from "@/lib/assistant/guided-shortcuts";

test("buildGuidedInvestigationShortcutHref clamps depth and normalizes defaults", () => {
  const href = buildGuidedInvestigationShortcutHref({
    source: "process",
    question: "   Why are orders delayed?   ",
    anchorObjectType: "   ",
    startAt: "not-a-date",
    endAt: "also-not-a-date",
    depth: 99,
  });

  const parsed = new URL(href, "http://localhost");
  assert.equal(parsed.pathname, "/insights");
  assert.equal(parsed.searchParams.get("question"), "Why are orders delayed?");
  assert.equal(parsed.searchParams.get("anchor_object_type"), "Order");
  assert.equal(parsed.searchParams.get("depth"), "3");

  const startAt = parsed.searchParams.get("start_at");
  const endAt = parsed.searchParams.get("end_at");
  assert.ok(startAt);
  assert.ok(endAt);
  assert.ok(!Number.isNaN(new Date(startAt!).valueOf()));
  assert.ok(!Number.isNaN(new Date(endAt!).valueOf()));
});

test("buildModuleGuidedShortcuts returns deterministic ordering and scoped links", () => {
  const shortcuts = buildModuleGuidedShortcuts({
    ontology: {
      conceptLabel: "Order",
    },
    rootCause: {
      anchorObjectType: "Order",
      startAt: "2026-02-20T00:00:00.000Z",
      endAt: "2026-02-21T00:00:00.000Z",
      depth: 2,
      outcomeEventType: "order.delayed",
    },
  });

  assert.deepEqual(
    shortcuts.map((shortcut) => shortcut.source),
    ["ontology", "root-cause"]
  );
  assert.match(shortcuts[0]!.description, /Order/);

  const rootCauseHref = new URL(shortcuts[1]!.href, "http://localhost");
  assert.equal(rootCauseHref.pathname, "/insights");
  assert.equal(rootCauseHref.searchParams.get("outcome_event_type"), "order.delayed");
  assert.equal(
    rootCauseHref.searchParams.get("question"),
    "What root-cause hypotheses should I verify next?"
  );
});
