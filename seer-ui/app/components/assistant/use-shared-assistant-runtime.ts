'use client';

import { useMemo } from 'react';
import { useExternalStoreRuntime } from '@assistant-ui/react';

import type { AssistantChatContext } from '@/app/lib/api/assistant-chat';
import {
  DEFAULT_THREAD_TITLE,
  getTextFromAppendMessage,
  toThreadMessage,
  useSharedAssistantState,
} from '@/app/components/assistant/shared-assistant-state';

interface UseSharedAssistantRuntimeOptions {
  context?: AssistantChatContext;
}

export function useSharedAssistantRuntime(options?: UseSharedAssistantRuntimeOptions) {
  const state = useSharedAssistantState();
  const activeThread = useMemo(
    () => state.threads.find((thread) => thread.id === state.activeThreadId) || null,
    [state.threads, state.activeThreadId]
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
      await state.sendMessage(userText, options?.context);
    },
    adapters: {
      threadList: {
        threadId: state.activeThreadId,
        isLoading: !state.hydrated,
        threads: state.threads.map((thread) => ({
          status: 'regular',
          id: thread.id,
          title: thread.title || DEFAULT_THREAD_TITLE,
        })),
        archivedThreads: [],
        onSwitchToThread: async (threadId: string) => {
          state.setActiveThreadId(threadId);
        },
        onSwitchToNewThread: async () => {
          state.createNewThread();
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
    runtime,
    activeThread,
    activeThreadMessages,
    ...state,
  };
}
