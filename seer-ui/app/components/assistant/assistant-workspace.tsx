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

import { parseWorkbenchSemanticBlock } from '@/app/lib/workbench-semantic-markdown';
import { AssistantCanvasPanel } from '@/app/components/assistant/assistant-canvas-panel';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import {
  type AssistantExperience,
  formatModuleName,
} from '@/app/components/assistant/shared-assistant-state';
import { useSharedAssistantRuntime } from '@/app/components/assistant/use-shared-assistant-runtime';

const QUICK_PROMPTS = [
  'Summarize the current process risk signals in this module.',
  'What should I investigate first based on this context?',
  'Explain this area in business language with concrete examples.',
];

function QuickPrompts({
  moduleName,
}: {
  moduleName: string;
}) {
  const aui = useAui();
  const promptPrefix =
    moduleName !== 'assistant' && moduleName !== 'general'
      ? `[${moduleName}] `
      : '';

  return (
    <div className="mt-4 grid gap-2">
      {QUICK_PROMPTS.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() =>
            aui.thread().append({
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `${promptPrefix}${prompt}`,
                },
              ],
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

function SemanticBlockLabel({ label }: { label: string }) {
  return (
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {label}
    </p>
  );
}

function AssistantTextPart({ text }: { text: string }) {
  const block = parseWorkbenchSemanticBlock(text);
  if (!block) {
    return (
      <MarkdownTextPrimitive className="space-y-3 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted/70 [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border/80 [&_pre]:bg-muted/50 [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold" />
    );
  }

  const toneClass =
    block.kind === 'evidence'
      ? 'border-emerald-500/25 bg-emerald-500/8'
      : block.kind === 'caveat'
        ? 'border-amber-500/30 bg-amber-500/10'
        : block.kind === 'next-action'
          ? 'border-sky-500/25 bg-sky-500/8'
          : block.kind === 'follow-up'
            ? 'border-violet-500/25 bg-violet-500/8'
            : 'border-primary/25 bg-primary/8';

  const label =
    block.kind === 'next-action'
      ? 'Recommendation'
      : block.kind === 'follow-up'
        ? 'Follow-up'
        : block.kind === 'linked-surface'
          ? 'Expert Handoff'
          : `${block.kind.charAt(0).toUpperCase()}${block.kind.slice(1)}`;
  const helperCopy =
    block.kind === 'next-action'
      ? 'Suggestion, not a finding'
      : block.kind === 'caveat'
        ? 'Read before acting'
        : block.kind === 'linked-surface'
          ? 'Use the expert surface to verify or drill deeper'
          : null;

  return (
    <div className={`rounded-2xl border px-3 py-3 ${toneClass}`}>
      <SemanticBlockLabel label={label} />
      {helperCopy ? (
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {helperCopy}
        </p>
      ) : null}
      {block.kind === 'linked-surface' ? (
        <div className="space-y-3">
          {block.attributes.label ? (
            <p className="text-sm font-semibold text-foreground">{block.attributes.label}</p>
          ) : null}
          <MarkdownTextPrimitive
            className="space-y-2 text-[13px] [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
            preprocess={() => block.body}
          />
          {block.attributes.href ? (
            <div>
              <a
                href={block.attributes.href}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary underline"
              >
                Open surface
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>
          ) : null}
        </div>
      ) : (
        <MarkdownTextPrimitive
          className="space-y-2 text-[13px] [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
          preprocess={() => block.body}
        />
      )}
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
            Text: (part) => (
              <div className="mb-3 last:mb-0">
                <AssistantTextPart text={part.text} />
              </div>
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
  experience?: AssistantExperience;
  variant: 'panel' | 'page';
  route: string;
  moduleName: string;
  onRequestClose?: () => void;
  seedPrompt?: string | null;
}

export function AssistantWorkspace({
  experience = 'assistant',
  variant,
  route,
  moduleName,
  onRequestClose,
  seedPrompt,
}: AssistantWorkspaceProps) {
  const {
    runtime,
    threads,
    activeThreadId,
    hydrated,
    activeCanvasState,
  } = useSharedAssistantRuntime({
    context: {
      route,
      module: moduleName,
    },
    experience,
  });
  const seedPromptRef = useRef('');
  const normalizedSeedPrompt = (seedPrompt || '').trim();
  const isPage = variant === 'page';
  const canvasVisible = isPage && activeCanvasState.visible;

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
  const headerClass = variant === 'panel'
    ? 'relative border-b border-border/75 bg-gradient-to-r from-card/95 to-background/90 px-5 py-4'
    : 'border-b border-border/70 bg-background/92 px-6 py-5 backdrop-blur';
  const viewportClass =
    variant === 'panel'
      ? 'relative min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-background via-background to-muted/20 px-5 py-4'
      : 'min-h-0 flex-1 overflow-y-auto px-6 py-6 lg:px-8';
  const sidebarClass =
    variant === 'panel'
      ? 'hidden w-64 shrink-0 border-r border-border/70 bg-card/55 p-3 md:block'
      : 'hidden w-60 shrink-0 border-r border-border/70 bg-muted/20 p-4 lg:block';
  const pageCardClass = 'h-[calc(100dvh-3rem)] overflow-hidden border-border/70 bg-background/95 p-0 shadow-sm';

  const workspaceContent = (
    <>
      <div className={headerClass} data-assistant-page-header={isPage ? 'true' : 'false'}>
        <div className="flex items-start justify-between gap-3">
          <div className="max-w-3xl">
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {variant === 'panel' ? 'Global Assistant' : 'Assistant'}
            </p>
            <h2 className="mt-1 font-display text-xl leading-none">
              {variant === 'panel' ? 'Atlas Copilot' : 'Seer Assistant'}
            </h2>
            {isPage ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Ask in business language. Seer can ground the answer, load the right skill, and
                open a canvas when a visual helps you inspect the result.
              </p>
            ) : null}
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/80 px-2.5 py-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              <p className="text-xs font-medium text-foreground/90">
                {variant === 'panel' ? `${formatModuleName(moduleName)} context` : 'Assistant context'}
              </p>
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
        <div
          data-assistant-page-shell={isPage ? 'true' : 'false'}
          data-canvas-open={canvasVisible ? 'true' : 'false'}
          className="flex min-h-0 flex-1"
        >
          <aside className={sidebarClass}>
            {isPage ? (
              <div className="mb-4 rounded-2xl border border-border/70 bg-background/70 p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                  Threads
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Keep the conversation running in one place. When the assistant presents an
                  artifact, the canvas stays attached to this thread.
                </p>
              </div>
            ) : null}
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

          <div className="flex min-w-0 flex-1 xl:flex-row">
            <ThreadPrimitive.Root
              data-assistant-thread-column
              className="flex min-w-0 flex-1 flex-col"
            >
              <ThreadPrimitive.Viewport className={viewportClass}>
                {isPage && canvasVisible ? (
                  <div className="mb-4 xl:hidden">
                    <AssistantCanvasPanel state={activeCanvasState} compact />
                  </div>
                ) : null}

                <AuiIf condition={({ thread }) => thread.isEmpty}>
                  <div className={`mx-auto pt-8 ${isPage ? 'max-w-2xl' : 'max-w-lg'}`}>
                    <div className="rounded-3xl border border-border/70 bg-card/75 p-6 shadow-sm sm:p-8">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                          <Sparkles className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {isPage ? 'Conversational by default' : 'Investigation-ready assistant'}
                          </p>
                          <p className="text-sm leading-6 text-muted-foreground">
                            {isPage
                              ? 'Start with a question. The assistant can bring a canvas in only when a visual adds clarity.'
                              : 'Grounded responses with evidence and caveats.'}
                          </p>
                        </div>
                      </div>
                      <QuickPrompts moduleName={moduleName} />
                      {isPage ? (
                        <p className="mt-4 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          Canvas opens beside the conversation when the assistant presents an artifact.
                        </p>
                      ) : null}
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
                    placeholder={isPage ? 'Ask Seer Assistant...' : 'Ask the assistant...'}
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

            {isPage ? (
              <div
                data-assistant-page-canvas
                className={`hidden min-h-0 min-w-0 flex-col overflow-hidden transition-[width,opacity,border-color] duration-300 ease-out xl:flex ${
                  canvasVisible
                    ? 'w-[min(44rem,50vw)] border-l border-border/70 opacity-100 2xl:w-[min(56rem,56vw)]'
                    : 'w-0 border-l border-transparent opacity-0'
                }`}
              >
                {canvasVisible ? <AssistantCanvasPanel state={activeCanvasState} /> : null}
              </div>
            ) : null}
          </div>
        </div>
      </AssistantRuntimeProvider>
    </>
  );

  if (variant === 'page') {
    return (
      <Card className={pageCardClass}>
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
