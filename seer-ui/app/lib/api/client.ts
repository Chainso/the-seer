/**
 * API client for communicating with the Seer backend
 */

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

export interface ApiError extends Error {
  status: number;
  statusText: string;
}

/**
 * Fetch wrapper with base URL and error handling
 */
export async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      if (body && typeof body === 'object' && typeof body.detail === 'string') {
        detail = `: ${body.detail}`;
      }
    } catch {
      // Non-JSON error body; use status text fallback.
    }
    const error = new Error(
      `API error: ${response.status} ${response.statusText}${detail}`
    ) as ApiError;
    error.status = response.status;
    error.statusText = response.statusText;
    throw error;
  }

  return response.json();
}
