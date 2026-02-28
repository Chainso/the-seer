import type { AssistantEvidenceRef } from "@/app/types/assistant";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /\b(?:\+?\d[\d\s().-]{7,}\d)\b/g;
const API_KEY_PATTERN = /\b(?:sk-[A-Za-z0-9]{16,}|api[_-]?key[=:]\S+|bearer\s+[A-Za-z0-9._-]{16,})\b/gi;
const SECRET_QUERY_PATTERN = /([?&](?:token|apikey|api_key|secret|password)=)([^&\s]+)/gi;

const REDACTION_TOKEN = "[REDACTED]";

export function redactSensitiveText(raw: string): { value: string; redacted: boolean } {
  let next = raw;
  const previous = next;
  next = next.replace(EMAIL_PATTERN, REDACTION_TOKEN);
  next = next.replace(PHONE_PATTERN, REDACTION_TOKEN);
  next = next.replace(API_KEY_PATTERN, REDACTION_TOKEN);
  next = next.replace(SECRET_QUERY_PATTERN, `$1${REDACTION_TOKEN}`);
  return {
    value: next,
    redacted: next !== previous,
  };
}

export function redactEvidenceRefs(
  evidence: AssistantEvidenceRef[]
): { value: AssistantEvidenceRef[]; redacted: boolean } {
  let didRedact = false;
  const value = evidence.map((item) => {
    const label = redactSensitiveText(item.label);
    const source = redactSensitiveText(item.source);
    const conceptUri = redactSensitiveText(item.conceptUri);
    didRedact = didRedact || label.redacted || source.redacted || conceptUri.redacted;
    return {
      ...item,
      label: label.value,
      source: source.value,
      conceptUri: conceptUri.value,
    };
  });
  return { value, redacted: didRedact };
}
