'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessage,
} from '@assistant-ui/react';
import { ArrowUpRight, Bot, Plus, SendHorizontal, Sparkles, Trash2, X } from 'lucide-react';

import type { AssistantChatMessage } from '@/app/lib/api/assistant-chat';
import { postAssistantChat } from '@/app/lib/api/assistant-chat';
import { Button } from '@/app/components/ui/button';

const THREAD_STORAGE_KEY = 'seer_global_assistant_threads_v1';
const MAX_THREAD_MESSAGES = 120;
const DEFAULT_THREAD_TITLE = 'New conversation';

type StoredRole = 'user' | 'assistant';

interface StoredMessage {
  id: string;
  role: StoredRole;
  text: string;
  at: string;
}

interface StoredThread {
  id: string;
  title: string;
  updatedAt: number;
  messages: StoredMessage[];
}

interface PersistedThreadPayload {
  version: 1;
  activeThreadId: string;
  threads: StoredThread[];
}

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function inferModuleFromPath(pathname: string): string {
  if (pathname.startsWith('/ontology')) return 'ontology';
  if (pathname.startsWith('/inspector/history')) return 'history';
  if (pathname.startsWith('/inspector')) return 'process';
  if (pathname.startsWith('/changes')) return 'changes';
  return 'general';
}

function formatModuleName(moduleName: string): string {
  if (!moduleName) return 'General';
  return `${moduleName.charAt(0).toUpperCase()}${moduleName.slice(1)}`;
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

function getTextFromAppendMessage(message: AppendMessage): string {
  const parts = Array.isArray(message.content) ? message.content : [];
  return parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim();
}

function toAssistantChatMessages(messages: StoredMessage[]): AssistantChatMessage[] {
  return messages
    .map((message) => ({
      role: message.role,
      content: message.text.trim(),
    }))
    .filter((message) => message.content.length > 0);
}

function toThreadMessage(message: StoredMessage): ThreadMessage {
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

const QUICK_PROMPTS = [
  'Summarize the current process risk signals in this module.',
  'What should I investigate first based on this context?',
  'Explain this area in business language with concrete examples.',
];

function QuickPrompts({ moduleName }: { moduleName: string }) {
  const aui = useAui();

  return (
    <div className="mt-4 grid gap-2">
      {QUICK_PROMPTS.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() =>
            aui.thread().append({
              role: 'user',
              content: [{ type: 'text', text: `[${moduleName}] ${prompt}` }],
            })
          }
          className="group rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/8"
        >
          <span className="flex items-start justify-between gap-3">
            <span className="text-foreground/95">{prompt}</span>
            <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
          </span>
        </button>
      ))}
    </div>
  );
}

function UserMessageBubble() {
  return (
    <MessagePrimitive.Root className="mb-3 flex justify-end">
      <div className="max-w-[86%] rounded-2xl rounded-tr-sm border border-primary/35 bg-gradient-to-br from-primary/20 to-primary/10 px-3 py-2 text-sm leading-relaxed shadow-[0_10px_28px_-14px_var(--primary)]">
        <MessagePrimitive.Content
          components={{
            Text: (part) => <p className="whitespace-pre-wrap">{part.text}</p>,
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessageBubble() {
  return (
    <MessagePrimitive.Root className="mb-3 flex justify-start">
      <div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-border/85 bg-card/95 px-3 py-2 text-sm leading-relaxed shadow-[0_8px_22px_-14px_color-mix(in_oklch,var(--foreground)_18%,transparent)]">
        <MessagePrimitive.Content
          components={{
            Text: (part) => <p className="whitespace-pre-wrap">{part.text}</p>,
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

function LoadingBubble() {
  return (
    <div className="mb-3 flex justify-start">
      <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-border/85 bg-card/95 px-3 py-2 shadow-[0_8px_22px_-14px_color-mix(in_oklch,var(--foreground)_18%,transparent)]">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:130ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:260ms]" />
      </div>
    </div>
  );
}

export function GlobalAssistantLayer() {
  const pathname = usePathname() || '/';
  const moduleName = useMemo(() => inferModuleFromPath(pathname), [pathname]);

  const [isOpen, setIsOpen] = useState(false);
  const [threads, setThreads] = useState<StoredThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [runningThreadId, setRunningThreadId] = useState<string | null>(null);

  const threadsRef = useRef<StoredThread[]>(threads);
  const activeThreadIdRef = useRef(activeThreadId);
  const moduleNameRef = useRef(moduleName);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    moduleNameRef.current = moduleName;
  }, [moduleName]);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const nowThread = createThread();
    let loadedThreads = [nowThread];
    let loadedActiveId = nowThread.id;

    try {
      const raw = localStorage.getItem(THREAD_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedThreadPayload>;
        if (Array.isArray(parsed.threads) && parsed.threads.length > 0) {
          loadedThreads = parsed.threads
            .filter(
              (thread): thread is StoredThread =>
                !!thread &&
                typeof thread.id === 'string' &&
                typeof thread.title === 'string' &&
                typeof thread.updatedAt === 'number' &&
                Array.isArray(thread.messages)
            )
            .map((thread) => ({
              id: thread.id,
              title: thread.title || DEFAULT_THREAD_TITLE,
              updatedAt: thread.updatedAt,
              messages: thread.messages
                .filter(
                  (message): message is StoredMessage =>
                    !!message &&
                    (message.role === 'user' || message.role === 'assistant') &&
                    typeof message.id === 'string' &&
                    typeof message.text === 'string' &&
                    typeof message.at === 'string'
                )
                .slice(-MAX_THREAD_MESSAGES),
            }));
          if (loadedThreads.length === 0) {
            loadedThreads = [nowThread];
          }
        }
        if (
          typeof parsed.activeThreadId === 'string' &&
          loadedThreads.some((thread) => thread.id === parsed.activeThreadId)
        ) {
          loadedActiveId = parsed.activeThreadId;
        } else {
          loadedActiveId = loadedThreads[0].id;
        }
      }
    } catch {
      loadedThreads = [nowThread];
      loadedActiveId = nowThread.id;
    }

    setThreads(loadedThreads);
    setActiveThreadId(loadedActiveId);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const payload: PersistedThreadPayload = {
      version: 1,
      activeThreadId,
      threads,
    };
    localStorage.setItem(THREAD_STORAGE_KEY, JSON.stringify(payload));
  }, [threads, activeThreadId, hydrated]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) || null,
    [threads, activeThreadId]
  );

  const activeThreadMessages = useMemo(
    () => (activeThread?.messages || []).map(toThreadMessage),
    [activeThread]
  );

  const updateThread = useCallback(
    (threadId: string, updater: (thread: StoredThread) => StoredThread) => {
      setThreads((previous) =>
        previous
          .map((thread) => (thread.id === threadId ? updater(thread) : thread))
          .sort((a, b) => b.updatedAt - a.updatedAt)
      );
    },
    []
  );

  const createNewThread = useCallback((seedText?: string): string => {
    const nextThread = createThread(seedText);
    setThreads((previous) => [nextThread, ...previous]);
    setActiveThreadId(nextThread.id);
    return nextThread.id;
  }, []);

  const runtime = useExternalStoreRuntime({
    messages: activeThreadMessages,
    isRunning: runningThreadId === activeThreadId,
    onNew: async (appendMessage) => {
      const userText = getTextFromAppendMessage(appendMessage);
      if (!userText) return;

      const currentActiveId = activeThreadIdRef.current || createNewThread(userText);
      const now = new Date().toISOString();
      const userMessage: StoredMessage = {
        id: makeId('msg-user'),
        role: 'user',
        text: userText,
        at: now,
      };

      const snapshot = threadsRef.current;
      const existingThread = snapshot.find((thread) => thread.id === currentActiveId);
      const baseThread = existingThread || createThread(userText);
      const nextMessages = [...baseThread.messages, userMessage].slice(-MAX_THREAD_MESSAGES);
      const nextTitle =
        baseThread.title === DEFAULT_THREAD_TITLE && userText.trim().length > 0
          ? userText.trim().slice(0, 42)
          : baseThread.title;

      if (!existingThread) {
        setThreads((previous) => [
          {
            ...baseThread,
            id: currentActiveId,
            title: nextTitle || DEFAULT_THREAD_TITLE,
            updatedAt: Date.now(),
            messages: nextMessages,
          },
          ...previous,
        ]);
      } else {
        updateThread(currentActiveId, (thread) => ({
          ...thread,
          title: nextTitle || DEFAULT_THREAD_TITLE,
          updatedAt: Date.now(),
          messages: nextMessages,
        }));
      }

      setRunningThreadId(currentActiveId);

      try {
        const response = await postAssistantChat({
          thread_id: currentActiveId,
          messages: toAssistantChatMessages(nextMessages),
          context: {
            route: pathnameRef.current,
            module: moduleNameRef.current,
          },
        });

        const evidence = response.evidence.slice(0, 2);
        const caveats = response.caveats.slice(0, 1);
        let answerText = response.answer.trim();
        if (evidence.length > 0) {
          answerText += `\n\nEvidence\n${evidence
            .map((item) => `- ${item.label}: ${item.detail}`)
            .join('\n')}`;
        }
        if (caveats.length > 0) {
          answerText += `\n\nCaveat\n- ${caveats[0]}`;
        }

        const assistantMessage: StoredMessage = {
          id: makeId('msg-assistant'),
          role: 'assistant',
          text: answerText,
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
        setRunningThreadId((current) => (current === currentActiveId ? null : current));
      }
    },
    adapters: {
      threadList: {
        threadId: activeThreadId,
        isLoading: !hydrated,
        threads: threads.map((thread) => ({
          status: 'regular',
          id: thread.id,
          title: thread.title || DEFAULT_THREAD_TITLE,
        })),
        archivedThreads: [],
        onSwitchToThread: async (threadId: string) => {
          setActiveThreadId(threadId);
        },
        onSwitchToNewThread: async () => {
          createNewThread();
        },
        onDelete: async (threadId: string) => {
          setThreads((previous) => {
            const remaining = previous.filter((thread) => thread.id !== threadId);
            if (remaining.length > 0) {
              if (activeThreadIdRef.current === threadId) {
                setActiveThreadId(remaining[0].id);
              }
              return remaining;
            }
            const fallback = createThread();
            setActiveThreadId(fallback.id);
            return [fallback];
          });
        },
        onRename: async (threadId: string, newTitle: string) => {
          const title = newTitle.trim() || DEFAULT_THREAD_TITLE;
          updateThread(threadId, (thread) => ({
            ...thread,
            title,
            updatedAt: Date.now(),
          }));
        },
      },
    },
  });

  return (
    <>
      {!isOpen && (
        <Button
          type="button"
          size="icon-lg"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-[60] rounded-full border border-primary/35 bg-primary text-primary-foreground shadow-[0_18px_50px_-18px_var(--primary)]"
          aria-label="Open assistant"
        >
          <Bot className="h-5 w-5" />
        </Button>
      )}

      {isOpen && (
        <div className="pointer-events-none fixed inset-0 z-50">
          <section className="absolute right-0 top-0 h-full w-full sm:w-[min(56rem,100vw)]">
            <div className="pointer-events-auto relative flex h-full flex-col overflow-hidden border-l border-border/75 bg-background/94 shadow-[-32px_0_90px_-50px_black] sm:rounded-l-[30px]">
              <div className="pointer-events-none absolute -top-20 right-[-5rem] h-60 w-60 rounded-full bg-primary/22 blur-3xl" />
              <div className="pointer-events-none absolute bottom-[-5rem] left-[-3rem] h-52 w-52 rounded-full bg-accent/28 blur-3xl" />

              <div className="relative border-b border-border/75 bg-gradient-to-r from-card/95 to-background/90 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Global Assistant</p>
                    <h2 className="mt-1 font-display text-xl leading-none">Atlas Copilot</h2>
                    <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/80 px-2.5 py-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                      <p className="text-xs font-medium text-foreground/90">{formatModuleName(moduleName)} context</p>
                    </div>
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => setIsOpen(false)} aria-label="Close panel">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <AssistantRuntimeProvider runtime={runtime}>
                <div className="flex min-h-0 flex-1">
                  <aside className="hidden w-64 shrink-0 border-r border-border/70 bg-card/55 p-3 md:block">
                    <Button
                      type="button"
                      onClick={() => runtime.threads.switchToNewThread()}
                      className="w-full justify-start gap-2"
                      variant="secondary"
                    >
                      <Plus className="h-4 w-4" />
                      New Thread
                    </Button>
                    <div className="mt-3 space-y-1 overflow-y-auto">
                      {threads.map((thread) => {
                        const isActive = thread.id === activeThreadId;
                        return (
                          <div key={thread.id} className="group flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => runtime.threads.switchToThread(thread.id)}
                              className={`flex-1 truncate rounded-lg px-2.5 py-2 text-left text-sm ${
                                isActive
                                  ? 'bg-primary/14 text-foreground'
                                  : 'text-muted-foreground hover:bg-accent'
                              }`}
                              title={thread.title}
                            >
                              {thread.title || DEFAULT_THREAD_TITLE}
                            </button>
                            <button
                              type="button"
                              onClick={() => runtime.threads.getItemById(thread.id).delete()}
                              className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover:opacity-100"
                              aria-label={`Delete ${thread.title}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </aside>

                  <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
                    <ThreadPrimitive.Viewport className="relative min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-background via-background to-muted/20 px-5 py-4">
                      <AuiIf condition={({ thread }) => thread.isEmpty}>
                        <div className="mx-auto max-w-lg pt-6">
                          <div className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-[0_16px_40px_-26px_black]">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/16 text-primary">
                                <Sparkles className="h-5 w-5" />
                              </div>
                              <div>
                                <p className="text-sm font-semibold">Investigation-ready assistant</p>
                                <p className="text-xs text-muted-foreground">Grounded responses with evidence and caveats.</p>
                              </div>
                            </div>
                            <QuickPrompts moduleName={moduleName} />
                          </div>
                        </div>
                      </AuiIf>

                      <AuiIf condition={({ thread }) => !thread.isEmpty}>
                        <ThreadPrimitive.Messages
                          components={{
                            UserMessage: UserMessageBubble,
                            AssistantMessage: AssistantMessageBubble,
                          }}
                        />
                        <AuiIf condition={({ thread }) => thread.isRunning}>
                          <LoadingBubble />
                        </AuiIf>
                      </AuiIf>
                    </ThreadPrimitive.Viewport>

                    <div className="border-t border-border/70 bg-background/95 p-4">
                      <ComposerPrimitive.Root className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-2xl border border-border/80 bg-card/80 p-2 shadow-[inset_0_1px_0_color-mix(in_oklch,var(--foreground)_8%,transparent)]">
                        <ComposerPrimitive.Input
                          className="max-h-36 min-h-[3rem] w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/50"
                          placeholder="Ask the assistant..."
                          rows={1}
                        />
                        <AuiIf condition={({ thread }) => thread.isRunning}>
                          <ComposerPrimitive.Cancel className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:bg-accent">
                            <X className="h-4 w-4" />
                          </ComposerPrimitive.Cancel>
                        </AuiIf>
                        <AuiIf condition={({ thread }) => !thread.isRunning}>
                          <ComposerPrimitive.Send className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_10px_24px_-12px_var(--primary)] hover:bg-primary/90 disabled:opacity-50">
                            <SendHorizontal className="h-4 w-4" />
                          </ComposerPrimitive.Send>
                        </AuiIf>
                        <p className="col-span-2 px-1 text-[11px] text-muted-foreground">
                          Enter to send. Shift+Enter for newline.
                        </p>
                      </ComposerPrimitive.Root>
                    </div>
                  </ThreadPrimitive.Root>
                </div>
              </AssistantRuntimeProvider>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
