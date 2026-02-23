"use client";

import { useCallback, useEffect, useState } from "react";

import { readPersistedBoolean, writePersistedBoolean } from "@/lib/assistant/persistence";

const DEFAULT_SAFE_MODE_STORAGE_KEY = "seer_assistant_safe_mode_v1";

type UseAssistantSafeModeOptions = {
  storageKey?: string;
  defaultSafeMode?: boolean;
};

export function useAssistantSafeMode(options?: UseAssistantSafeModeOptions): {
  safeMode: boolean;
  loaded: boolean;
  setSafeMode: (next: boolean) => void;
  toggleSafeMode: () => void;
} {
  const storageKey = options?.storageKey ?? DEFAULT_SAFE_MODE_STORAGE_KEY;
  const defaultSafeMode = options?.defaultSafeMode ?? true;

  const [safeMode, setSafeMode] = useState(defaultSafeMode);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const persisted = readPersistedBoolean(storageKey, defaultSafeMode);
    let canceled = false;

    Promise.resolve().then(() => {
      if (canceled) {
        return;
      }
      setSafeMode(persisted);
      setLoaded(true);
    });

    return () => {
      canceled = true;
    };
  }, [defaultSafeMode, storageKey]);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    writePersistedBoolean(storageKey, safeMode);
  }, [loaded, safeMode, storageKey]);

  const toggleSafeMode = useCallback(() => {
    setSafeMode((current) => !current);
  }, []);

  return {
    safeMode,
    loaded,
    setSafeMode,
    toggleSafeMode,
  };
}
