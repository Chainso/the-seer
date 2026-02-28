'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
} from '@assistant-ui/react';
import { Bot, Loader2, SendHorizontal, Sparkles, X } from 'lucide-react';

import type { AssistantChatMessage } from '@/app/lib/api/assistant-chat';
import { postAssistantChat } from '@/app/lib/api/assistant-chat';
import { Button } from '@/app/components/ui/button';

function inferModuleFromPath(pathname: string): string {
  if (pathname.startsWith('/ontology')) {
    return 'ontology';
  }
  if (pathname.startsWith('/inspector/history')) {
    return 'history';
  }
  if (pathname.startsWith('/inspector')) {
    return 'process';
  }
  if (pathname.startsWith('/changes')) {
    return 'changes';
  }
  return 'general';
}

function formatModuleName(moduleName: string): string {
  if (!moduleName) {
    return 'General';
  }
  return `${moduleName.charAt(0).toUpperCase()}${moduleName.slice(1)}`;
}

function extractChatMessages(rawMessages: unknown[]): AssistantChatMessage[] {
  const messages: AssistantChatMessage[] = [];
  for (const rawMessage of rawMessages) {
    if (!rawMessage || typeof rawMessage !== 'object') {
      continue;
    }
    const candidate = rawMessage as { role?: unknown; content?: unknown };
    if (candidate.role !== 'user' && candidate.role !== 'assistant') {
      continue;
    }
    const parts = Array.isArray(candidate.content) ? candidate.content : [];
    const text = parts
      .map((part) => {
        if (!part || typeof part !== 'object') {
          return '';
        }
        const candidatePart = part as { type?: unknown; text?: unknown };
        if (candidatePart.type !== 'text' || typeof candidatePart.text !== 'string') {
          return '';
        }
        return candidatePart.text;
      })
      .join('\n')
      .trim();
    if (!text) {
      continue;
    }
    messages.push({ role: candidate.role, content: text });
  }
  return messages;
}

function UserMessageBubble() {
  return (
    <MessagePrimitive.Root className="mb-3 flex justify-end">
      <div className="max-w-[86%] rounded-2xl rounded-tr-sm border border-primary/35 bg-primary/16 px-3 py-2 text-sm leading-relaxed shadow-[0_8px_20px_-12px_var(--primary)]">
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessageBubble() {
  return (
    <MessagePrimitive.Root className="mb-3 flex justify-start">
      <div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-border/80 bg-card/95 px-3 py-2 text-sm leading-relaxed shadow-[0_8px_20px_-14px_color-mix(in_oklch,var(--foreground)_20%,transparent)]">
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
}

export function GlobalAssistantLayer() {
  const pathname = usePathname() || '/';
  const [isOpen, setIsOpen] = useState(false);
  const [threadId] = useState(() => `assistant-thread-${Date.now()}`);
  const moduleName = useMemo(() => inferModuleFromPath(pathname), [pathname]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const runtime = useLocalRuntime({
    async run({ messages, abortSignal }) {
      const chatMessages = extractChatMessages(messages);
      if (chatMessages.length === 0) {
        return {
          content: [{ type: 'text', text: 'Start by typing a question for the assistant.' }],
        };
      }

      const response = await postAssistantChat(
        {
          thread_id: threadId,
          messages: chatMessages,
          context: {
            route: pathname,
            module: moduleName,
          },
        },
        abortSignal
      );

      const evidence = response.evidence.slice(0, 2);
      const caveats = response.caveats.slice(0, 1);
      let text = response.answer.trim();
      if (evidence.length > 0) {
        text += `\n\nEvidence\n${evidence.map((item) => `- ${item.label}: ${item.detail}`).join('\n')}`;
      }
      if (caveats.length > 0) {
        text += `\n\nCaveat\n- ${caveats[0]}`;
      }

      return {
        content: [{ type: 'text', text }],
      };
    },
  });

  return (
    <>
      <Button
        type="button"
        size="icon-lg"
        onClick={() => setIsOpen((previous) => !previous)}
        className="fixed bottom-6 right-6 z-[60] rounded-full border border-primary/30 bg-primary text-primary-foreground shadow-[0_14px_42px_-16px_var(--primary)]"
        aria-label={isOpen ? 'Close assistant' : 'Open assistant'}
      >
        {isOpen ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="absolute inset-0 bg-background/40 backdrop-blur-[1px]"
            aria-label="Dismiss assistant panel"
          />
          <section className="absolute bottom-20 right-3 h-[min(44rem,calc(100vh-6.5rem))] w-[min(34rem,calc(100vw-1.5rem))] overflow-hidden rounded-3xl border border-border/80 bg-background/96 shadow-[0_40px_90px_-38px_black]">
            <div className="flex h-full flex-col">
              <div className="border-b border-border/80 bg-gradient-to-r from-card to-background px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Global Assistant</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                      <p className="text-sm font-semibold">{formatModuleName(moduleName)} context</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-border bg-card px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      Read-only tools
                    </span>
                    <Button type="button" variant="ghost" size="icon" onClick={() => setIsOpen(false)} aria-label="Close panel">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <AssistantRuntimeProvider runtime={runtime}>
                <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
                  <ThreadPrimitive.Empty className="flex flex-1 items-center justify-center px-6 text-center">
                    <div className="space-y-2">
                      <Sparkles className="mx-auto h-5 w-5 text-muted-foreground" />
                      <p className="text-sm font-medium">Ask across ontology, process, and history context.</p>
                      <p className="text-xs text-muted-foreground">This panel stays available while you navigate routes.</p>
                    </div>
                  </ThreadPrimitive.Empty>

                  <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-background via-background to-muted/20 px-4 py-4">
                    <ThreadPrimitive.Messages
                      components={{
                        UserMessage: UserMessageBubble,
                        AssistantMessage: AssistantMessageBubble,
                      }}
                    />
                  </ThreadPrimitive.Viewport>

                  <div className="border-t border-border/70 bg-background/95 p-3">
                    <ComposerPrimitive.Root className="flex items-end gap-2">
                      <ComposerPrimitive.Input
                        className="max-h-36 min-h-[3rem] flex-1 resize-none rounded-xl border border-input bg-card px-3 py-2 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/50"
                        placeholder="Ask the assistant..."
                        rows={1}
                      />
                      <AuiIf condition={({ thread }) => thread.isRunning}>
                        <ComposerPrimitive.Cancel className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:bg-accent">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </ComposerPrimitive.Cancel>
                      </AuiIf>
                      <AuiIf condition={({ thread }) => !thread.isRunning}>
                        <ComposerPrimitive.Send className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_10px_24px_-12px_var(--primary)] hover:bg-primary/90 disabled:opacity-50">
                          <SendHorizontal className="h-4 w-4" />
                        </ComposerPrimitive.Send>
                      </AuiIf>
                    </ComposerPrimitive.Root>
                  </div>
                </ThreadPrimitive.Root>
              </AssistantRuntimeProvider>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
