type JsonParser<T> = (value: unknown) => T | null;

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

export function readPersistedJson<T>(key: string, parser: JsonParser<T>): T | null {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parser(parsed);
  } catch {
    return null;
  }
}

export function writePersistedJson<T>(key: string, value: T): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  storage.setItem(key, JSON.stringify(value));
}

export function readPersistedBoolean(key: string, fallback: boolean): boolean {
  const storage = getLocalStorage();
  if (!storage) {
    return fallback;
  }

  const raw = storage.getItem(key);
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  return fallback;
}

export function writePersistedBoolean(key: string, value: boolean): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  storage.setItem(key, String(value));
}

export function readPersistedString(key: string): string | null {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  return storage.getItem(key);
}

export function writePersistedString(key: string, value: string): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  storage.setItem(key, value);
}
