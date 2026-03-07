'use client';

import { useEffect, useMemo } from 'react';
import { useExternalStoreRuntime } from '@assistant-ui/react';

import type { AssistantChatContext } from '@/app/lib/api/assistant-chat';
import {
  type AssistantExperience,
  DEFAULT_THREAD_TITLE,
  getTextFromAppendMessage,
  toThreadMessage,
  useSharedAssistantState,
} from '@/app/components/assistant/shared-assistant-state';

interface UseSharedAssistantRuntimeOptions {
  context?: AssistantChatContext;
  experience?: AssistantExperience;
}

export function useSharedAssistantRuntime(options?: UseSharedAssistantRuntimeOptions) {
  const state = useSharedAssistantState();
  const experience = options?.experience ?? 'assistant';
  const {
    activeThreadId,
    createNewThread,
    hydrated,
    setActiveThreadId,
  } = state;
  const scopedThreads = useMemo(
    () => state.threads.filter((thread) => thread.experience === experience),
    [state.threads, experience]
  );

  useEffect(() => {
    if (!hydrated) return;
    if (scopedThreads.some((thread) => thread.id === activeThreadId)) return;
    if (scopedThreads[0]) {
      setActiveThreadId(scopedThreads[0].id);
      return;
    }
    createNewThread(undefined, experience);
  }, [
    activeThreadId,
    createNewThread,
    experience,
    hydrated,
    scopedThreads,
    setActiveThreadId,
  ]);

  const activeThread = useMemo(
    () =>
      scopedThreads.find((thread) => thread.id === activeThreadId) ||
      scopedThreads[0] ||
      null,
    [scopedThreads, activeThreadId]
  );
  const activeThreadMessages = useMemo(
    () => (activeThread?.messages || []).map(toThreadMessage),
    [activeThread]
  );

  const runtime = useExternalStoreRuntime({
    messages: activeThreadMessages,
    isRunning: state.isThreadRunning(state.activeThreadId),
    onNew: async (appendMessage) => {
      const userText = getTextFromAppendMessage(appendMessage);
      if (!userText) return;
      await state.sendMessage(userText, options?.context, options?.experience);
    },
    onCancel: async () => {
      state.cancelThread(state.activeThreadId);
    },
    adapters: {
      threadList: {
        threadId: activeThread?.id ?? state.activeThreadId,
        isLoading: !state.hydrated,
        threads: scopedThreads.map((thread) => ({
          status: 'regular',
          id: thread.id,
          title: thread.title || DEFAULT_THREAD_TITLE,
        })),
        archivedThreads: [],
        onSwitchToThread: async (threadId: string) => {
          state.setActiveThreadId(threadId);
        },
        onSwitchToNewThread: async () => {
          state.createNewThread(undefined, experience);
        },
        onDelete: async (threadId: string) => {
          state.deleteThread(threadId);
        },
        onRename: async (threadId: string, newTitle: string) => {
          state.renameThread(threadId, newTitle);
        },
      },
    },
  });

  return {
    ...state,
    threads: scopedThreads,
    runtime,
    activeThread,
    activeThreadMessages,
  };
}
