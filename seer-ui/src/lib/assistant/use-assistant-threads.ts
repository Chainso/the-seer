"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  readPersistedString,
  writePersistedJson,
  writePersistedString,
} from "@/lib/assistant/persistence";
import {
  createAssistantThread,
  parseStoredAssistantThreads,
  resolveAssistantActiveThreadId,
  updateAssistantThreadMessages,
} from "@/lib/assistant/threads";
import type { AssistantMessage, AssistantThread } from "@/lib/assistant/types";

type UseAssistantThreadsOptions = {
  threadsStorageKey?: string;
  activeThreadStorageKey?: string;
  initialThreadTitle?: string;
  maxMessagesPerThread?: number;
};

const DEFAULT_THREADS_STORAGE_KEY = "seer_assistant_threads_v1";
const DEFAULT_ACTIVE_THREAD_STORAGE_KEY = "seer_assistant_active_thread_id_v1";

export function useAssistantThreads<TPayload = unknown>(options?: UseAssistantThreadsOptions): {
  threads: AssistantThread<TPayload>[];
  activeThreadId: string;
  activeThread: AssistantThread<TPayload> | null;
  loaded: boolean;
  setActiveThreadId: (threadId: string) => void;
  createThread: (title?: string) => string;
  replaceThreads: (threads: AssistantThread<TPayload>[]) => void;
  updateThreadMessages: (
    threadId: string,
    updater: (messages: AssistantMessage<TPayload>[]) => AssistantMessage<TPayload>[],
    titleSeed?: string
  ) => void;
} {
  const threadsStorageKey = options?.threadsStorageKey ?? DEFAULT_THREADS_STORAGE_KEY;
  const activeThreadStorageKey =
    options?.activeThreadStorageKey ?? DEFAULT_ACTIVE_THREAD_STORAGE_KEY;
  const initialThreadTitle = options?.initialThreadTitle ?? "New thread";
  const maxMessagesPerThread = options?.maxMessagesPerThread ?? 120;

  const [threads, setThreads] = useState<AssistantThread<TPayload>[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const persistedThreads = parseStoredAssistantThreads(readPersistedString(threadsStorageKey));
    const initialThreads =
      persistedThreads.length > 0
        ? (persistedThreads as AssistantThread<TPayload>[])
        : [createAssistantThread(initialThreadTitle) as AssistantThread<TPayload>];

    const storedActiveId = readPersistedString(activeThreadStorageKey);
    const resolvedActiveId = resolveAssistantActiveThreadId(initialThreads, storedActiveId);
    let canceled = false;

    Promise.resolve().then(() => {
      if (canceled) {
        return;
      }
      setThreads(initialThreads);
      setActiveThreadId(resolvedActiveId);
      setLoaded(true);
    });

    return () => {
      canceled = true;
    };
  }, [activeThreadStorageKey, initialThreadTitle, threadsStorageKey]);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    writePersistedJson(threadsStorageKey, threads);
  }, [loaded, threads, threadsStorageKey]);

  useEffect(() => {
    if (!loaded || !activeThreadId) {
      return;
    }

    writePersistedString(activeThreadStorageKey, activeThreadId);
  }, [activeThreadId, activeThreadStorageKey, loaded]);

  const replaceThreads = useCallback((nextThreads: AssistantThread<TPayload>[]) => {
    setThreads(nextThreads);
    setActiveThreadId((current) => resolveAssistantActiveThreadId(nextThreads, current));
  }, []);

  const updateThreadMessages = useCallback(
    (
      threadId: string,
      updater: (messages: AssistantMessage<TPayload>[]) => AssistantMessage<TPayload>[],
      titleSeed?: string
    ) => {
      setThreads((current) =>
        updateAssistantThreadMessages(current, threadId, updater, {
          maxMessages: maxMessagesPerThread,
          titleSeed,
        })
      );
    },
    [maxMessagesPerThread]
  );

  const createThread = useCallback(
    (title?: string): string => {
      const thread = createAssistantThread(title ?? initialThreadTitle) as AssistantThread<TPayload>;
      setThreads((current) => [thread, ...current]);
      setActiveThreadId(thread.id);
      return thread.id;
    },
    [initialThreadTitle]
  );

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads]
  );

  return {
    threads,
    activeThreadId,
    activeThread,
    loaded,
    setActiveThreadId,
    createThread,
    replaceThreads,
    updateThreadMessages,
  };
}
