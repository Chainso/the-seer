import type { AiEvidenceItem } from "@/lib/backend-ai";

import type { AssistantPanelContent } from "@/lib/assistant/types";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /\b(?:\+?\d[\d\s().-]{7,}\d)\b/g;
const API_KEY_PATTERN = /\b(?:sk-[A-Za-z0-9]{16,}|api[_-]?key[=:]\S+|bearer\s+[A-Za-z0-9._-]{16,})\b/gi;
const SECRET_QUERY_PATTERN = /([?&](?:token|apikey|api_key|secret|password)=)([^&\s]+)/gi;

export const REDACTION_TOKEN = "[REDACTED]";

function applySensitiveTextMask(raw: string): string {
  let value = raw;
  value = value.replace(EMAIL_PATTERN, REDACTION_TOKEN);
  value = value.replace(PHONE_PATTERN, REDACTION_TOKEN);
  value = value.replace(API_KEY_PATTERN, REDACTION_TOKEN);
  value = value.replace(SECRET_QUERY_PATTERN, `$1${REDACTION_TOKEN}`);
  return value;
}

export function redactSensitiveText(raw: string): { value: string; redacted: boolean } {
  const value = applySensitiveTextMask(raw);
  return {
    value,
    redacted: value !== raw,
  };
}

export function redactStringList(input: string[]): { value: string[]; redacted: boolean } {
  let didRedact = false;
  const value = input.map((item) => {
    const redacted = redactSensitiveText(item);
    didRedact = didRedact || redacted.redacted;
    return redacted.value;
  });

  return {
    value,
    redacted: didRedact,
  };
}

function redactEvidenceUri(uri: string | null): { value: string | null; redacted: boolean } {
  if (!uri) {
    return {
      value: null,
      redacted: false,
    };
  }

  const masked = redactSensitiveText(uri);
  return {
    value: masked.value,
    redacted: masked.redacted,
  };
}

export function redactEvidenceItems(evidence: AiEvidenceItem[]): {
  value: AiEvidenceItem[];
  redacted: boolean;
} {
  let didRedact = false;

  const value = evidence.map((item) => {
    const label = redactSensitiveText(item.label);
    const detail = redactSensitiveText(item.detail);
    const uri = redactEvidenceUri(item.uri);

    didRedact = didRedact || label.redacted || detail.redacted || uri.redacted;

    return {
      ...item,
      label: label.value,
      detail: detail.value,
      uri: uri.value,
    };
  });

  return {
    value,
    redacted: didRedact,
  };
}

export function redactAssistantPanelContent(content: AssistantPanelContent): {
  value: AssistantPanelContent;
  redacted: boolean;
} {
  const summary = redactSensitiveText(content.summary);
  const evidence = redactEvidenceItems(content.evidence);
  const caveats = redactStringList(content.caveats);
  const nextActions = redactStringList(content.nextActions);

  return {
    value: {
      summary: summary.value,
      evidence: evidence.value,
      caveats: caveats.value,
      nextActions: nextActions.value,
    },
    redacted: summary.redacted || evidence.redacted || caveats.redacted || nextActions.redacted,
  };
}
