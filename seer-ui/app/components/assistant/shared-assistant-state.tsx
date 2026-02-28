'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AppendMessage, ThreadMessage } from '@assistant-ui/react';

import {
  postAssistantChat,
  type AssistantChatContext,
  type AssistantChatMessage,
} from '@/app/lib/api/assistant-chat';

const CANONICAL_STORAGE_KEY = 'seer_assistant_threads_v3';
const STORAGE_SYNC_CHANNEL = 'seer_assistant_threads_sync_v1';

export const DEFAULT_THREAD_TITLE = 'New conversation';
const MAX_THREAD_MESSAGES = 120;

type StoredRole = 'user' | 'assistant';

export interface StoredMessage {
  id: string;
  role: StoredRole;
  text: string;
  at: string;
}

export interface StoredThread {
  id: string;
  title: string;
  updatedAt: number;
  messages: StoredMessage[];
}

interface PersistedThreadPayloadV3 {
  version: 3;
  activeThreadId: string;
  threads: StoredThread[];
}

interface SharedAssistantStateContextValue {
  hydrated: boolean;
  threads: StoredThread[];
  activeThreadId: string;
  setActiveThreadId: (threadId: string) => void;
  createNewThread: (seedText?: string) => string;
  deleteThread: (threadId: string) => void;
  renameThread: (threadId: string, title: string) => void;
  sendMessage: (userText: string, context?: AssistantChatContext) => Promise<void>;
  isThreadRunning: (threadId: string) => boolean;
}

const SharedAssistantStateContext = createContext<SharedAssistantStateContextValue | null>(null);

export function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sortThreads(threads: StoredThread[]): StoredThread[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

function createThread(seedText?: string): StoredThread {
  const now = Date.now();
  const trimmed = (seedText || '').trim();
  const title =
    trimmed.length === 0
      ? DEFAULT_THREAD_TITLE
      : trimmed.length <= 42
        ? trimmed
        : `${trimmed.slice(0, 42)}...`;
  return {
    id: makeId('thread'),
    title,
    updatedAt: now,
    messages: [],
  };
}

function normalizeMessage(input: unknown): StoredMessage | null {
  if (!input || typeof input !== 'object') return null;
  const maybe = input as Partial<StoredMessage> & { content?: string };
  const role = maybe.role;
  if (role !== 'user' && role !== 'assistant') return null;
  const id = typeof maybe.id === 'string' && maybe.id ? maybe.id : makeId(`msg-${role}`);
  const at = typeof maybe.at === 'string' && maybe.at ? maybe.at : new Date().toISOString();
  const text =
    typeof maybe.text === 'string'
      ? maybe.text
      : typeof maybe.content === 'string'
        ? maybe.content
        : '';
  return {
    id,
    role,
    text,
    at,
  };
}

function normalizeThreads(rawThreads: unknown): StoredThread[] {
  if (!Array.isArray(rawThreads)) return [];
  return sortThreads(
    rawThreads
      .map((thread): StoredThread | null => {
        if (!thread || typeof thread !== 'object') return null;
        const maybe = thread as Partial<StoredThread> & { createdAt?: string; updatedAt?: number | string };
        if (typeof maybe.id !== 'string' || !maybe.id) return null;
        const title =
          typeof maybe.title === 'string' && maybe.title.trim().length > 0
            ? maybe.title.trim()
            : DEFAULT_THREAD_TITLE;
        const updatedAt =
          typeof maybe.updatedAt === 'number'
            ? maybe.updatedAt
            : typeof maybe.updatedAt === 'string'
              ? Date.parse(maybe.updatedAt)
              : typeof maybe.createdAt === 'string'
                ? Date.parse(maybe.createdAt)
                : Date.now();

        const messages = Array.isArray((maybe as { messages?: unknown[] }).messages)
          ? ((maybe as { messages?: unknown[] }).messages || [])
              .map(normalizeMessage)
              .filter((message): message is StoredMessage => !!message)
              .slice(-MAX_THREAD_MESSAGES)
          : [];

        return {
          id: maybe.id,
          title,
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
          messages,
        };
      })
      .filter((thread): thread is StoredThread => !!thread)
  );
}

function parseV3Payload(raw: string): PersistedThreadPayloadV3 | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedThreadPayloadV3>;
    const threads = normalizeThreads(parsed.threads);
    if (threads.length === 0) return null;
    const activeThreadId =
      typeof parsed.activeThreadId === 'string' && threads.some((thread) => thread.id === parsed.activeThreadId)
        ? parsed.activeThreadId
        : threads[0].id;
    return {
      version: 3,
      activeThreadId,
      threads,
    };
  } catch {
    return null;
  }
}

function loadCanonicalStorage(): PersistedThreadPayloadV3 {
  const v3Raw = localStorage.getItem(CANONICAL_STORAGE_KEY);
  if (v3Raw) {
    const parsedV3 = parseV3Payload(v3Raw);
    if (parsedV3) return parsedV3;
  }

  const fallback = createThread();
  return {
    version: 3,
    activeThreadId: fallback.id,
    threads: [fallback],
  };
}

function serializePayload(threads: StoredThread[], activeThreadId: string): string {
  const payload: PersistedThreadPayloadV3 = {
    version: 3,
    activeThreadId,
    threads,
  };
  return JSON.stringify(payload);
}

function getTitleFromText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return DEFAULT_THREAD_TITLE;
  return trimmed.length <= 42 ? trimmed : `${trimmed.slice(0, 42)}...`;
}

function toAssistantChatMessages(messages: StoredMessage[]): AssistantChatMessage[] {
  return messages
    .map((message) => ({
      role: message.role,
      content: message.text.trim(),
    }))
    .filter((message) => message.content.length > 0);
}

function getMessageText(message: AppendMessage): string {
  const parts = Array.isArray(message.content) ? message.content : [];
  return parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim();
}

export function getTextFromAppendMessage(message: AppendMessage): string {
  return getMessageText(message);
}

export function toThreadMessage(message: StoredMessage): ThreadMessage {
  const createdAt = new Date(message.at);
  if (message.role === 'user') {
    return {
      id: message.id,
      role: 'user',
      createdAt,
      content: [{ type: 'text', text: message.text }],
      attachments: [],
      metadata: { custom: {} },
    };
  }
  return {
    id: message.id,
    role: 'assistant',
    createdAt,
    content: [{ type: 'text', text: message.text }],
    status: { type: 'complete', reason: 'stop' },
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  };
}

export function inferModuleFromPath(pathname: string): string {
  if (pathname.startsWith('/ontology')) return 'ontology';
  if (pathname.startsWith('/inspector/history')) return 'history';
  if (pathname.startsWith('/inspector')) return 'process';
  return 'general';
}

export function formatModuleName(moduleName: string): string {
  if (!moduleName) return 'General';
  return `${moduleName.charAt(0).toUpperCase()}${moduleName.slice(1)}`;
}

export function SharedAssistantStateProvider({ children }: { children: React.ReactNode }) {
  const [threads, setThreads] = useState<StoredThread[]>([]);
  const [activeThreadId, setActiveThreadIdState] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [runningThreadIds, setRunningThreadIds] = useState<string[]>([]);

  const threadsRef = useRef<StoredThread[]>(threads);
  const activeThreadIdRef = useRef(activeThreadId);
  const lastSerializedRef = useRef('');
  const channelRef = useRef<BroadcastChannel | null>(null);
  const instanceIdRef = useRef(makeId('assistant-instance'));

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const applyRemoteState = useCallback((serialized: string) => {
    if (!serialized || serialized === lastSerializedRef.current) return;
    const parsed = parseV3Payload(serialized);
    if (!parsed) return;
    lastSerializedRef.current = serialized;
    setThreads(parsed.threads);
    setActiveThreadIdState(parsed.activeThreadId);
  }, []);

  useEffect(() => {
    const initial = loadCanonicalStorage();
    const serialized = serializePayload(initial.threads, initial.activeThreadId);
    lastSerializedRef.current = serialized;
    setThreads(initial.threads);
    setActiveThreadIdState(initial.activeThreadId);
    localStorage.setItem(CANONICAL_STORAGE_KEY, serialized);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const serialized = serializePayload(threads, activeThreadId);
    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;
    localStorage.setItem(CANONICAL_STORAGE_KEY, serialized);
    channelRef.current?.postMessage({
      source: instanceIdRef.current,
      payload: serialized,
    });
  }, [threads, activeThreadId, hydrated]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CANONICAL_STORAGE_KEY || typeof event.newValue !== 'string') return;
      applyRemoteState(event.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [applyRemoteState]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(STORAGE_SYNC_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<{ source?: string; payload?: string }>) => {
      const message = event.data;
      if (!message || message.source === instanceIdRef.current || typeof message.payload !== 'string') return;
      applyRemoteState(message.payload);
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [applyRemoteState]);

  const updateThread = useCallback((threadId: string, updater: (thread: StoredThread) => StoredThread) => {
    setThreads((previous) =>
      sortThreads(previous.map((thread) => (thread.id === threadId ? updater(thread) : thread)))
    );
  }, []);

  const createNewThread = useCallback((seedText?: string): string => {
    const nextThread = createThread(seedText);
    setThreads((previous) => sortThreads([nextThread, ...previous]));
    setActiveThreadIdState(nextThread.id);
    return nextThread.id;
  }, []);

  const setActiveThreadId = useCallback((threadId: string) => {
    if (!threadId) return;
    setActiveThreadIdState((current) => {
      if (current === threadId) return current;
      if (!threadsRef.current.some((thread) => thread.id === threadId)) return current;
      return threadId;
    });
  }, []);

  const deleteThread = useCallback(
    (threadId: string) => {
      setThreads((previous) => {
        const remaining = previous.filter((thread) => thread.id !== threadId);
        if (remaining.length === 0) {
          const fallback = createThread();
          setActiveThreadIdState(fallback.id);
          return [fallback];
        }
        if (activeThreadIdRef.current === threadId) {
          setActiveThreadIdState(remaining[0].id);
        }
        return remaining;
      });
      setRunningThreadIds((previous) => previous.filter((id) => id !== threadId));
    },
    []
  );

  const renameThread = useCallback(
    (threadId: string, title: string) => {
      const normalizedTitle = title.trim() || DEFAULT_THREAD_TITLE;
      updateThread(threadId, (thread) => ({
        ...thread,
        title: normalizedTitle,
        updatedAt: Date.now(),
      }));
    },
    [updateThread]
  );

  const sendMessage = useCallback(
    async (userText: string, context?: AssistantChatContext) => {
      const trimmed = userText.trim();
      if (!trimmed) return;

      const currentActiveId = activeThreadIdRef.current || createNewThread(trimmed);
      const now = new Date().toISOString();
      const userMessage: StoredMessage = {
        id: makeId('msg-user'),
        role: 'user',
        text: trimmed,
        at: now,
      };

      const snapshot = threadsRef.current;
      const existingThread = snapshot.find((thread) => thread.id === currentActiveId);
      const baseThread = existingThread || createThread(trimmed);
      const nextMessages = [...baseThread.messages, userMessage].slice(-MAX_THREAD_MESSAGES);
      const nextTitle =
        baseThread.title === DEFAULT_THREAD_TITLE ? getTitleFromText(trimmed) : baseThread.title;

      if (!existingThread) {
        setThreads((previous) =>
          sortThreads([
            {
              ...baseThread,
              id: currentActiveId,
              title: nextTitle || DEFAULT_THREAD_TITLE,
              updatedAt: Date.now(),
              messages: nextMessages,
            },
            ...previous.filter((thread) => thread.id !== currentActiveId),
          ])
        );
      } else {
        updateThread(currentActiveId, (thread) => ({
          ...thread,
          title: nextTitle || DEFAULT_THREAD_TITLE,
          updatedAt: Date.now(),
          messages: nextMessages,
        }));
      }

      setRunningThreadIds((previous) =>
        previous.includes(currentActiveId) ? previous : [...previous, currentActiveId]
      );

      try {
        const response = await postAssistantChat({
          thread_id: currentActiveId,
          messages: toAssistantChatMessages(nextMessages),
          context,
        });

        const assistantMessage: StoredMessage = {
          id: makeId('msg-assistant'),
          role: 'assistant',
          text: response.answer.trim(),
          at: new Date().toISOString(),
        };

        updateThread(currentActiveId, (thread) => ({
          ...thread,
          updatedAt: Date.now(),
          messages: [...thread.messages, assistantMessage].slice(-MAX_THREAD_MESSAGES),
        }));
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Assistant request failed';
        const assistantMessage: StoredMessage = {
          id: makeId('msg-assistant'),
          role: 'assistant',
          text: `I hit an error while generating a response.\n\n${detail}`,
          at: new Date().toISOString(),
        };

        updateThread(currentActiveId, (thread) => ({
          ...thread,
          updatedAt: Date.now(),
          messages: [...thread.messages, assistantMessage].slice(-MAX_THREAD_MESSAGES),
        }));
      } finally {
        setRunningThreadIds((previous) => previous.filter((id) => id !== currentActiveId));
      }
    },
    [createNewThread, updateThread]
  );

  const isThreadRunning = useCallback(
    (threadId: string) => runningThreadIds.includes(threadId),
    [runningThreadIds]
  );

  const value = useMemo<SharedAssistantStateContextValue>(
    () => ({
      hydrated,
      threads,
      activeThreadId,
      setActiveThreadId,
      createNewThread,
      deleteThread,
      renameThread,
      sendMessage,
      isThreadRunning,
    }),
    [
      hydrated,
      threads,
      activeThreadId,
      setActiveThreadId,
      createNewThread,
      deleteThread,
      renameThread,
      sendMessage,
      isThreadRunning,
    ]
  );

  return (
    <SharedAssistantStateContext.Provider value={value}>
      {children}
    </SharedAssistantStateContext.Provider>
  );
}

export function useSharedAssistantState(): SharedAssistantStateContextValue {
  const context = useContext(SharedAssistantStateContext);
  if (!context) {
    throw new Error('useSharedAssistantState must be used within SharedAssistantStateProvider');
  }
  return context;
}
