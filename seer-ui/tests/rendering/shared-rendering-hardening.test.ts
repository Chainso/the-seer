import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AiResponsePanel } from "@/components/ai-response-panel";
import { RunStatePill } from "@/components/run-state-pill";

test("RunStatePill renders stable state labels", () => {
  const defaultLabel = renderToStaticMarkup(React.createElement(RunStatePill, { state: "running" }));
  assert.match(defaultLabel, /Running/);

  const customLabel = renderToStaticMarkup(
    React.createElement(RunStatePill, { state: "error", label: "Investigation failed" })
  );
  assert.match(customLabel, /Investigation failed/);
});

test("AiResponsePanel applies safe-mode redaction and keeps non-safe-mode transparent", () => {
  const safeModeHtml = renderToStaticMarkup(
    React.createElement(AiResponsePanel, {
      heading: "AI Summary",
      summary: "Contact ops@example.com with the report.",
      evidence: [
        {
          label: "Incident owner",
          detail: "ops@example.com",
          uri: "https://seer.local/case?token=abc123",
        },
      ],
      caveats: ["api_key=abc123 should not leak"],
      nextActions: ["Call +1 (555) 123-4567"],
      safeMode: true,
      showEvidenceUris: true,
    })
  );
  assert.match(safeModeHtml, /\[REDACTED\]/);
  assert.match(safeModeHtml, /Safe mode on \(redaction active\)/);

  const rawHtml = renderToStaticMarkup(
    React.createElement(AiResponsePanel, {
      heading: "AI Summary",
      summary: "Contact ops@example.com with the report.",
      evidence: [{ label: "Incident owner", detail: "ops@example.com", uri: null }],
      caveats: [],
      nextActions: [],
      safeMode: false,
    })
  );
  assert.match(rawHtml, /ops@example.com/);
  assert.ok(!rawHtml.includes("Safe mode on (redaction active)"));
});
