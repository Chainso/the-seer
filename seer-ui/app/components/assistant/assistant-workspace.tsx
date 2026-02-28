'use client';

import { useEffect, useRef } from 'react';
import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useMessage,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import { ArrowUpRight, Plus, SendHorizontal, Sparkles, Trash2, X } from 'lucide-react';

import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { formatModuleName } from '@/app/components/assistant/shared-assistant-state';
import { useSharedAssistantRuntime } from '@/app/components/assistant/use-shared-assistant-runtime';

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
  const hasRenderableText = useMessage((state) =>
    state.content.some((part) => part.type === 'text' && part.text.trim().length > 0)
  );
  if (!hasRenderableText) {
    return null;
  }

  return (
    <MessagePrimitive.Root className="mb-3 flex justify-start">
      <div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-border/85 bg-card/95 px-3 py-2 text-sm leading-relaxed shadow-[0_8px_22px_-14px_color-mix(in_oklch,var(--foreground)_18%,transparent)]">
        <MessagePrimitive.Content
          components={{
            Text: () => (
              <MarkdownTextPrimitive className="space-y-3 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted/70 [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border/80 [&_pre]:bg-muted/50 [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold" />
            ),
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

interface AssistantWorkspaceProps {
  variant: 'panel' | 'page';
  route: string;
  moduleName: string;
  onRequestClose?: () => void;
  seedPrompt?: string | null;
}

export function AssistantWorkspace({
  variant,
  route,
  moduleName,
  onRequestClose,
  seedPrompt,
}: AssistantWorkspaceProps) {
  const { runtime, threads, activeThreadId, hydrated } = useSharedAssistantRuntime({
    context: {
      route,
      module: moduleName,
    },
  });
  const seedPromptRef = useRef('');
  const normalizedSeedPrompt = (seedPrompt || '').trim();

  useEffect(() => {
    if (variant !== 'page') return;
    if (!hydrated || !normalizedSeedPrompt) return;
    if (seedPromptRef.current === normalizedSeedPrompt) return;
    seedPromptRef.current = normalizedSeedPrompt;
    runtime.thread.append({
      role: 'user',
      content: [{ type: 'text', text: normalizedSeedPrompt }],
    });
  }, [variant, hydrated, normalizedSeedPrompt, runtime]);

  const panelFrameClass =
    'relative flex h-full flex-col overflow-hidden border-l border-border/75 bg-background/94 shadow-[-32px_0_90px_-50px_black] sm:rounded-l-[30px]';
  const headerClass =
    variant === 'panel'
      ? 'relative border-b border-border/75 bg-gradient-to-r from-card/95 to-background/90 px-5 py-4'
      : 'border-b px-6 py-4';
  const viewportClass =
    variant === 'panel'
      ? 'relative min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-background via-background to-muted/20 px-5 py-4'
      : 'min-h-0 flex-1 overflow-y-auto px-6 py-4';
  const sidebarClass =
    variant === 'panel'
      ? 'hidden w-64 shrink-0 border-r border-border/70 bg-card/55 p-3 md:block'
      : 'hidden w-64 shrink-0 border-r p-3 md:block';

  const workspaceContent = (
    <>
      <div className={headerClass}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {variant === 'panel' ? 'Global Assistant' : 'Assistant Workspace'}
            </p>
            <h2 className="mt-1 font-display text-xl leading-none">Atlas Copilot</h2>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/80 px-2.5 py-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              <p className="text-xs font-medium text-foreground/90">{formatModuleName(moduleName)} context</p>
            </div>
          </div>
          {variant === 'panel' && onRequestClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onRequestClose}
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <AssistantRuntimeProvider runtime={runtime}>
        <div className="flex min-h-0 flex-1">
          <aside className={sidebarClass}>
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
                        isActive ? 'bg-primary/14 text-foreground' : 'text-muted-foreground hover:bg-accent'
                      }`}
                      title={thread.title}
                    >
                      {thread.title}
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
            <ThreadPrimitive.Viewport className={viewportClass}>
              <AuiIf condition={({ thread }) => thread.isEmpty}>
                <div className="mx-auto max-w-lg pt-6">
                  <div className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-[0_16px_40px_-26px_black]">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/16 text-primary">
                        <Sparkles className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Investigation-ready assistant</p>
                        <p className="text-xs text-muted-foreground">
                          Grounded responses with evidence and caveats.
                        </p>
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
    </>
  );

  if (variant === 'page') {
    return (
      <Card className="h-[calc(100dvh-3rem)] overflow-hidden p-0">
        {workspaceContent}
      </Card>
    );
  }

  return (
    <div className={panelFrameClass}>
      <div className="pointer-events-none absolute -top-20 right-[-5rem] h-60 w-60 rounded-full bg-primary/22 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-5rem] left-[-3rem] h-52 w-52 rounded-full bg-accent/28 blur-3xl" />
      {workspaceContent}
    </div>
  );
}
