export interface ParsedSseEvent {
  event: string;
  payload: unknown;
}

function normalizeApiBase(rawBase: string): string {
  const trimmed = rawBase.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return 'http://localhost:8000/api/v1';
  }

  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    if (!normalizedPath || normalizedPath === '/') {
      parsed.pathname = '/api/v1';
    } else if (normalizedPath === '/api') {
      parsed.pathname = '/api/v1';
    } else if (normalizedPath === '/api/v1') {
      parsed.pathname = '/api/v1';
    } else {
      parsed.pathname = normalizedPath;
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    if (trimmed.endsWith('/api')) {
      return `${trimmed}/v1`;
    }
    return trimmed;
  }
}

const API_BASE = normalizeApiBase(
  process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:8000/api/v1'
);

export function getApiUrl(endpoint: string): string {
  return `${API_BASE}${endpoint}`;
}

export function asObject(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  return payload as Record<string, unknown>;
}

export function readErrorDetail(payload: unknown): string {
  const data = asObject(payload);
  if (typeof data.detail === 'string' && data.detail.trim().length > 0) {
    return data.detail;
  }
  return '';
}

export function parseSseEvent(rawEvent: string): ParsedSseEvent | null {
  let eventName = '';
  const dataLines: string[] = [];

  for (const line of rawEvent.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      const data = line.slice(5);
      dataLines.push(data.startsWith(' ') ? data.slice(1) : data);
    }
  }

  if (!eventName) return null;

  const payloadText = dataLines.join('\n');
  let payload: unknown = {};
  if (payloadText.trim().length > 0) {
    try {
      payload = JSON.parse(payloadText);
    } catch {
      throw new Error(`Assistant stream event "${eventName}" had invalid JSON payload`);
    }
  }

  return { event: eventName, payload };
}
