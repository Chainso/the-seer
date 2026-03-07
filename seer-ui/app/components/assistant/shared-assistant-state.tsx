'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AppendMessage, ThreadMessage } from '@assistant-ui/react';

import {
  postAssistantChatStream,
  type AssistantCompletionMessage,
  type AssistantChatContext,
  type AssistantChatResponse,
} from '@/app/lib/api/assistant-chat';
import {
  postWorkbenchChatStream,
  type WorkbenchChatResponse,
  type WorkbenchClarifyingQuestion,
  type WorkbenchLinkedSurface,
} from '@/app/lib/api/workbench';
import { parseWorkbenchMarkdownParts } from '@/app/lib/workbench-semantic-markdown';

const CANONICAL_STORAGE_KEY = 'seer_assistant_threads_v3';
const STORAGE_SYNC_CHANNEL = 'seer_assistant_threads_sync_v1';

export const DEFAULT_THREAD_TITLE = 'New conversation';
const MAX_THREAD_MESSAGES = 120;
const MAX_COMPLETION_MESSAGES = 400;

type StoredRole = 'user' | 'assistant';
export type AssistantExperience = 'assistant' | 'workbench';

export interface StoredWorkbenchMessage {
  answerMarkdown: string;
  turnKind: 'investigation_answer' | 'clarifying_question';
  whyItMatters: string;
  followUpQuestions: string[];
  linkedSurfaces: WorkbenchLinkedSurface[];
  clarifyingQuestions: WorkbenchClarifyingQuestion[];
  investigationId: string;
}

export interface StoredMessage {
  id: string;
  role: StoredRole;
  text: string;
  at: string;
  workbench?: StoredWorkbenchMessage | null;
}

export interface StoredThread {
  id: string;
  title: string;
  updatedAt: number;
  experience: AssistantExperience;
  investigationId?: string | null;
  messages: StoredMessage[];
  completionMessages: AssistantCompletionMessage[];
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
  createNewThread: (seedText?: string, experience?: AssistantExperience) => string;
  deleteThread: (threadId: string) => void;
  renameThread: (threadId: string, title: string) => void;
  sendMessage: (
    userText: string,
    context?: AssistantChatContext,
    experience?: AssistantExperience
  ) => Promise<void>;
  cancelThread: (threadId: string) => void;
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

function createThread(seedText?: string, experience: AssistantExperience = 'assistant'): StoredThread {
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
    experience,
    investigationId: null,
    messages: [],
    completionMessages: [],
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
    workbench: normalizeWorkbenchMessage((maybe as { workbench?: unknown }).workbench),
  };
}

function normalizeWorkbenchMessage(input: unknown): StoredWorkbenchMessage | null {
  if (!input || typeof input !== 'object') return null;
  const maybe = input as Partial<StoredWorkbenchMessage>;
  if (typeof maybe.answerMarkdown !== 'string' || !maybe.answerMarkdown.trim()) return null;
  if (
    maybe.turnKind !== 'investigation_answer' &&
    maybe.turnKind !== 'clarifying_question'
  ) {
    return null;
  }

  return {
    answerMarkdown: maybe.answerMarkdown,
    turnKind: maybe.turnKind,
    whyItMatters: typeof maybe.whyItMatters === 'string' ? maybe.whyItMatters : '',
    followUpQuestions: Array.isArray(maybe.followUpQuestions)
      ? maybe.followUpQuestions.filter((item): item is string => typeof item === 'string')
      : [],
    linkedSurfaces: Array.isArray(maybe.linkedSurfaces)
      ? maybe.linkedSurfaces.filter(
          (item): item is WorkbenchLinkedSurface =>
            !!item &&
            typeof item === 'object' &&
            typeof (item as WorkbenchLinkedSurface).kind === 'string' &&
            typeof (item as WorkbenchLinkedSurface).label === 'string' &&
            typeof (item as WorkbenchLinkedSurface).href === 'string' &&
            typeof (item as WorkbenchLinkedSurface).reason === 'string'
        )
      : [],
    clarifyingQuestions: Array.isArray(maybe.clarifyingQuestions)
      ? maybe.clarifyingQuestions.filter(
          (item): item is WorkbenchClarifyingQuestion =>
            !!item &&
            typeof item === 'object' &&
            typeof (item as WorkbenchClarifyingQuestion).field === 'string' &&
            typeof (item as WorkbenchClarifyingQuestion).prompt === 'string'
        )
      : [],
    investigationId: typeof maybe.investigationId === 'string' ? maybe.investigationId : '',
  };
}

function toStoredWorkbenchMessage(payload: WorkbenchChatResponse): StoredWorkbenchMessage {
  return {
    answerMarkdown: payload.answer_markdown,
    turnKind: payload.turn_kind,
    whyItMatters: payload.why_it_matters,
    followUpQuestions: payload.follow_up_questions || [],
    linkedSurfaces: payload.linked_surfaces || [],
    clarifyingQuestions: payload.clarifying_questions || [],
    investigationId: payload.investigation_id,
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
        const completionMessages = normalizeCompletionMessages(
          (maybe as { completionMessages?: unknown[] }).completionMessages
        );

        return {
          id: maybe.id,
          title,
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
          experience: maybe.experience === 'workbench' ? 'workbench' : 'assistant',
          investigationId:
            typeof maybe.investigationId === 'string' ? maybe.investigationId : null,
          messages,
          completionMessages,
        };
      })
      .filter((thread): thread is StoredThread => !!thread)
  );
}

function normalizeCompletionMessages(raw: unknown): AssistantCompletionMessage[] {
  if (!Array.isArray(raw)) return [];

  const normalized: AssistantCompletionMessage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const maybe = entry as Record<string, unknown>;
    const role = maybe.role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') {
      continue;
    }
    const next: AssistantCompletionMessage = { role };
    for (const [key, value] of Object.entries(maybe)) {
      if (key === 'role') continue;
      next[key] = value;
    }
    normalized.push(next);
  }

  return normalized.slice(-MAX_COMPLETION_MESSAGES);
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

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function upsertAssistantMessage(
  messages: StoredMessage[],
  messageId: string,
  at: string,
  text: string,
  workbench?: StoredWorkbenchMessage | null
): StoredMessage[] {
  const existingIndex = messages.findIndex((message) => message.id === messageId);
  if (existingIndex >= 0) {
    return messages.map((message, index) =>
      index === existingIndex
        ? { ...message, text, at: message.at || at, workbench: workbench ?? message.workbench ?? null }
        : message
    );
  }
  return [
    ...messages,
    {
      id: messageId,
      role: 'assistant',
      text,
      at,
      workbench: workbench ?? null,
    } satisfies StoredMessage,
  ].slice(-MAX_THREAD_MESSAGES);
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
  const content =
    message.workbench?.answerMarkdown
      ? parseWorkbenchMarkdownParts(message.workbench.answerMarkdown).map((part) => ({
          type: 'text' as const,
          text: part.text,
        }))
      : [{ type: 'text' as const, text: message.text }];
  return {
    id: message.id,
    role: 'assistant',
    createdAt,
    content,
    status: { type: 'complete', reason: 'stop' },
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {
        workbench: message.workbench ?? null,
      },
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
  const abortControllersRef = useRef<Record<string, AbortController>>({});

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

  useEffect(
    () => () => {
      const controllers = Object.values(abortControllersRef.current);
      for (const controller of controllers) {
        controller.abort();
      }
      abortControllersRef.current = {};
    },
    []
  );

  const updateThread = useCallback((threadId: string, updater: (thread: StoredThread) => StoredThread) => {
    setThreads((previous) =>
      sortThreads(previous.map((thread) => (thread.id === threadId ? updater(thread) : thread)))
    );
  }, []);

  const createNewThread = useCallback(
    (seedText?: string, experience: AssistantExperience = 'assistant'): string => {
      const nextThread = createThread(seedText, experience);
      setThreads((previous) => sortThreads([nextThread, ...previous]));
      setActiveThreadIdState(nextThread.id);
      return nextThread.id;
    },
    []
  );

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
      const controller = abortControllersRef.current[threadId];
      if (controller) {
        controller.abort();
        delete abortControllersRef.current[threadId];
      }
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

  const cancelThread = useCallback((threadId: string) => {
    if (!threadId) return;
    const controller = abortControllersRef.current[threadId];
    if (!controller) return;
    controller.abort();
    delete abortControllersRef.current[threadId];
    setRunningThreadIds((previous) => previous.filter((id) => id !== threadId));
  }, []);

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
    async (
      userText: string,
      context?: AssistantChatContext,
      requestedExperience: AssistantExperience = 'assistant'
    ) => {
      const trimmed = userText.trim();
      if (!trimmed) return;

      const now = new Date().toISOString();
      const userMessage: StoredMessage = {
        id: makeId('msg-user'),
        role: 'user',
        text: trimmed,
        at: now,
      };
      const assistantMessageId = makeId('msg-assistant');
      const assistantMessageAt = new Date().toISOString();

      const snapshot = threadsRef.current;
      const threadExperience =
        requestedExperience ||
        (context?.module === 'workbench' ? 'workbench' : 'assistant');
      const matchingActiveThread = snapshot.find(
        (thread) =>
          thread.id === activeThreadIdRef.current && thread.experience === threadExperience
      );
      const existingThread =
        matchingActiveThread ||
        snapshot.find((thread) => thread.experience === threadExperience);
      const currentActiveId =
        existingThread?.id || createNewThread(trimmed, threadExperience);
      if (activeThreadIdRef.current !== currentActiveId) {
        setActiveThreadIdState(currentActiveId);
      }
      const baseThread = existingThread || createThread(trimmed, threadExperience);
      const nextMessages = [...baseThread.messages, userMessage].slice(-MAX_THREAD_MESSAGES);
      const nextMessagesWithPlaceholder = upsertAssistantMessage(
        nextMessages,
        assistantMessageId,
        assistantMessageAt,
        ''
      ).slice(-MAX_THREAD_MESSAGES);
      const nextCompletionMessages = [
        ...(baseThread.completionMessages || []),
        { role: 'user', content: trimmed } satisfies AssistantCompletionMessage,
      ].slice(-MAX_COMPLETION_MESSAGES);
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
              experience: threadExperience,
              messages: nextMessagesWithPlaceholder,
              completionMessages: nextCompletionMessages,
            },
            ...previous.filter((thread) => thread.id !== currentActiveId),
          ])
        );
      } else {
        updateThread(currentActiveId, (thread) => ({
          ...thread,
          title: nextTitle || DEFAULT_THREAD_TITLE,
          updatedAt: Date.now(),
          experience: threadExperience,
          messages: nextMessagesWithPlaceholder,
          completionMessages: nextCompletionMessages,
        }));
      }

      abortControllersRef.current[currentActiveId]?.abort();
      const abortController = new AbortController();
      abortControllersRef.current[currentActiveId] = abortController;
      setRunningThreadIds((previous) =>
        previous.includes(currentActiveId) ? previous : [...previous, currentActiveId]
      );

      let streamedAssistantText = '';
      let finalEvent: AssistantChatResponse | null = null;
      let finalWorkbenchEvent: WorkbenchChatResponse | null = null;

      const setAssistantText = (nextText: string, workbench?: StoredWorkbenchMessage | null) => {
        updateThread(currentActiveId, (thread) => ({
          ...thread,
          updatedAt: Date.now(),
          messages: upsertAssistantMessage(
            thread.messages,
            assistantMessageId,
            assistantMessageAt,
            nextText,
            workbench
          ).slice(-MAX_THREAD_MESSAGES),
        }));
      };

      try {
        if (threadExperience === 'workbench') {
          const streamResult = await postWorkbenchChatStream(
            {
              question: trimmed,
              context: {
                ...context,
                module: 'workbench',
              },
              thread_id: currentActiveId,
              investigation_id: baseThread.investigationId || undefined,
            },
            {
              onAssistantDelta: ({ text }) => {
                if (!text) return;
                streamedAssistantText += text;
                setAssistantText(streamedAssistantText);
              },
              onFinal: (payload) => {
                finalWorkbenchEvent = payload;
              },
            },
            abortController.signal
          );

          if (!finalWorkbenchEvent) {
            finalWorkbenchEvent = streamResult.final;
          }
        } else {
          const streamResult = await postAssistantChatStream(
            {
              thread_id: currentActiveId,
              completion_messages: nextCompletionMessages,
              context,
            },
            {
              onAssistantDelta: ({ text }) => {
                if (!text) return;
                streamedAssistantText += text;
                setAssistantText(streamedAssistantText);
              },
              onFinal: (payload) => {
                finalEvent = payload;
              },
            },
            abortController.signal
          );

          if (!finalEvent) {
            finalEvent = streamResult.final;
          }
        }

        const workbenchMetadata = finalWorkbenchEvent
          ? toStoredWorkbenchMessage(finalWorkbenchEvent)
          : null;
        const finalAnswer =
          streamedAssistantText.trim() ||
          (typeof finalEvent?.answer === 'string'
            ? finalEvent.answer.trim()
            : workbenchMetadata?.answerMarkdown.trim() || '');

        updateThread(currentActiveId, (thread) => {
          const finalizedMessages =
            finalAnswer.length > 0
              ? upsertAssistantMessage(
                  thread.messages,
                  assistantMessageId,
                  assistantMessageAt,
                  finalAnswer,
                  workbenchMetadata
                ).slice(-MAX_THREAD_MESSAGES)
              : thread.messages.filter((message) => message.id !== assistantMessageId);

          const canonicalCompletionMessages = finalEvent
            ? normalizeCompletionMessages(finalEvent.completion_messages)
            : [];
          const completionMessages =
            canonicalCompletionMessages.length > 0
              ? canonicalCompletionMessages
              : finalAnswer.length > 0
                ? [
                    ...(thread.completionMessages || []),
                    {
                      role: 'assistant',
                      content: finalAnswer,
                    } satisfies AssistantCompletionMessage,
                  ].slice(-MAX_COMPLETION_MESSAGES)
                : thread.completionMessages;

          return {
            ...thread,
            updatedAt: Date.now(),
            experience: threadExperience,
            investigationId: workbenchMetadata?.investigationId || thread.investigationId || null,
            messages: finalizedMessages,
            completionMessages,
          };
        });
      } catch (error) {
        if (isAbortError(error)) {
          const partialAnswer = streamedAssistantText.trim();
          updateThread(currentActiveId, (thread) => ({
            ...thread,
            updatedAt: Date.now(),
            messages:
              partialAnswer.length > 0
                ? upsertAssistantMessage(
                  thread.messages,
                  assistantMessageId,
                  assistantMessageAt,
                  partialAnswer
                ).slice(-MAX_THREAD_MESSAGES)
                : thread.messages.filter((message) => message.id !== assistantMessageId),
          }));
          return;
        }

        const detail = error instanceof Error ? error.message : 'Assistant request failed';
        const errorMessage = `I hit an error while generating a response.\n\n${detail}`;

        updateThread(currentActiveId, (thread) => ({
          ...thread,
          updatedAt: Date.now(),
          messages: upsertAssistantMessage(
            thread.messages,
            assistantMessageId,
            assistantMessageAt,
            errorMessage
          ).slice(-MAX_THREAD_MESSAGES),
          completionMessages: [
            ...(thread.completionMessages || []),
            {
              role: 'assistant',
              content: errorMessage,
            } satisfies AssistantCompletionMessage,
          ].slice(-MAX_COMPLETION_MESSAGES),
        }));
      } finally {
        const isCurrentController = abortControllersRef.current[currentActiveId] === abortController;
        if (isCurrentController) {
          delete abortControllersRef.current[currentActiveId];
          setRunningThreadIds((previous) => previous.filter((id) => id !== currentActiveId));
        }
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
      cancelThread,
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
      cancelThread,
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
