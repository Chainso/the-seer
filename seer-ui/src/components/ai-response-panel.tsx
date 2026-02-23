"use client";

import { type ComponentProps, useMemo } from "react";

import type { AiEvidenceItem } from "@/lib/backend-ai";
import { redactAssistantPanelContent } from "@/lib/assistant/redaction";

export type AiResponsePanelProps = Omit<ComponentProps<"section">, "title"> & {
  title?: string;
  heading?: string;
  summary: string;
  evidence: AiEvidenceItem[];
  caveats: string[];
  nextActions: string[];
  safeMode?: boolean;
  showEvidenceUris?: boolean;
  showSafeModeBadge?: boolean;
};

export function AiResponsePanel({
  title,
  heading,
  summary,
  evidence,
  caveats,
  nextActions,
  safeMode = true,
  showEvidenceUris = false,
  showSafeModeBadge = true,
  className,
  ...props
}: AiResponsePanelProps) {
  const panelHeading = heading ?? title ?? "AI response";

  const panel = useMemo(() => {
    const base = {
      summary,
      evidence,
      caveats,
      nextActions,
    };

    if (!safeMode) {
      return {
        value: base,
        redacted: false,
      };
    }

    return redactAssistantPanelContent(base);
  }, [caveats, evidence, nextActions, safeMode, summary]);

  return (
    <section
      className={["assist-block", className].filter(Boolean).join(" ")}
      aria-label={panelHeading}
      {...props}
    >
      <h3>{panelHeading}</h3>
      <p>{panel.value.summary}</p>

      {showSafeModeBadge && safeMode && panel.redacted ? (
        <p className="status ok">Safe mode on (redaction active)</p>
      ) : null}

      {panel.value.evidence.length > 0 ? (
        <div>
          <p className="field-label">Evidence</p>
          <ul>
            {panel.value.evidence.map((item) => (
              <li key={`${item.label}-${item.detail}-${item.uri ?? "none"}`}>
                <strong>{item.label}:</strong> {item.detail}
                {showEvidenceUris && item.uri ? (
                  <>
                    <br />
                    <code>{item.uri}</code>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {panel.value.caveats.length > 0 ? (
        <div>
          <p className="field-label">Caveats</p>
          <ul>
            {panel.value.caveats.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {panel.value.nextActions.length > 0 ? (
        <div>
          <p className="field-label">Next Actions</p>
          <ul>
            {panel.value.nextActions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
