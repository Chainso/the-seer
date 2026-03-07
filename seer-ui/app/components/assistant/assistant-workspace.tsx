'use client';

import { useEffect, useMemo, useRef } from 'react';
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
import { ArrowUpRight, LoaderCircle, Plus, SearchCheck, SendHorizontal, Sparkles, Trash2, X } from 'lucide-react';

import { parseWorkbenchSemanticBlock } from '@/app/lib/workbench-semantic-markdown';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import {
  type AssistantExperience,
  formatModuleName,
  type StoredThread,
  type StoredWorkbenchMessage,
} from '@/app/components/assistant/shared-assistant-state';
import { useSharedAssistantRuntime } from '@/app/components/assistant/use-shared-assistant-runtime';
import { useOntologyDisplay } from '@/app/lib/ontology-display';

const QUICK_PROMPTS: Record<AssistantExperience, string[]> = {
  assistant: [
    'Summarize the current process risk signals in this module.',
    'What should I investigate first based on this context?',
    'Explain this area in business language with concrete examples.',
  ],
  workbench: [
    'Investigate the main operational risks in this area.',
    'What changed recently that deserves investigation first?',
    'Summarize the strongest evidence and the biggest caveats.',
  ],
};

const WORKBENCH_WINDOW_PRESETS = [
  { key: '24h', label: 'Last 24h', hours: 24 },
  { key: '7d', label: 'Last 7d', hours: 24 * 7 },
  { key: '30d', label: 'Last 30d', hours: 24 * 30 },
] as const;

function buildWindowPreset(hours: number) {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  return {
    start_at: start.toISOString(),
    end_at: end.toISOString(),
  };
}

function getLatestUserQuestion(thread: StoredThread | null): string {
  if (!thread) return '';
  const latestUserMessage = [...thread.messages]
    .reverse()
    .find((message) => message.role === 'user');
  return latestUserMessage?.text.trim() || '';
}

function formatScopedWindow(startAt?: string | null, endAt?: string | null): string {
  if (!startAt || !endAt) return '';
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
    return '';
  }
  return `${start.toLocaleString()} to ${end.toLocaleString()}`;
}

function matchesPreset(startAt: string | undefined, endAt: string | undefined, hours: number): boolean {
  if (!startAt || !endAt) return false;
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;

  const durationMs = hours * 60 * 60 * 1000;
  const driftMs = Math.abs(Date.now() - end);
  return Math.abs((end - start) - durationMs) < 120_000 && driftMs < 120_000;
}

function QuickPrompts({
  moduleName,
  experience,
}: {
  moduleName: string;
  experience: AssistantExperience;
}) {
  const aui = useAui();
  const promptPrefix =
    experience === 'assistant' && moduleName !== 'assistant' && moduleName !== 'general'
      ? `[${moduleName}] `
      : '';

  return (
    <div className="mt-4 grid gap-2">
      {QUICK_PROMPTS[experience].map((prompt) => (
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

function WorkbenchTextPart({ text }: { text: string }) {
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
  const workbench = useMessage((state) => {
    const custom = state.metadata?.custom as { workbench?: StoredWorkbenchMessage | null } | undefined;
    return custom?.workbench ?? null;
  });
  if (!hasRenderableText) {
    return null;
  }

  return (
    <MessagePrimitive.Root className="mb-3 flex justify-start">
      <div
        className={`rounded-2xl rounded-tl-sm border border-border/85 bg-card/95 px-3 py-2 text-sm leading-relaxed shadow-[0_8px_22px_-14px_color-mix(in_oklch,var(--foreground)_18%,transparent)] ${
          workbench ? 'w-full max-w-none' : 'max-w-[90%]'
        }`}
      >
        {workbench && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ${
                workbench.turnKind === 'clarifying_question'
                  ? 'border border-amber-500/25 bg-amber-500/10 text-amber-700'
                  : 'border border-primary/20 bg-primary/10 text-primary'
              }`}
            >
              {workbench.turnKind === 'clarifying_question' ? 'Clarify Scope' : 'Investigation'}
            </span>
            {workbench.whyItMatters && (
              <p className="text-xs text-muted-foreground">{workbench.whyItMatters}</p>
            )}
          </div>
        )}
        <MessagePrimitive.Content
          components={{
            Text: (part) => (
              <div className="mb-3 last:mb-0">
                <WorkbenchTextPart text={part.text} />
              </div>
            ),
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

function WorkbenchClarificationPanel({
  thread,
  disabled,
  onSetContext,
  onRun,
}: {
  thread: StoredThread;
  disabled: boolean;
  onSetContext: (context: { anchor_object_type?: string; start_at?: string; end_at?: string }) => void;
  onRun: (question: string) => void;
}) {
  const ontologyDisplay = useOntologyDisplay();
  const scope = thread.workbenchContext || {};
  const latestUserQuestion = getLatestUserQuestion(thread);
  const objectOptions = useMemo(
    () =>
      [...ontologyDisplay.catalog.objectModels]
        .map((model) => ({
          value: model.uri,
          label: ontologyDisplay.displayObjectType(model.uri),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [ontologyDisplay]
  );
  const selectedWindow = formatScopedWindow(scope.start_at, scope.end_at);
  const canRun =
    Boolean(latestUserQuestion) &&
    Boolean(scope.anchor_object_type) &&
    Boolean(scope.start_at) &&
    Boolean(scope.end_at);

  return (
    <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4 shadow-[0_18px_34px_-24px_rgba(217,119,6,0.45)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
            Clarify scope
          </p>
          <p className="mt-2 text-sm text-foreground">
            Pick an object and time window. The rerun keeps this thread and reuses your original
            question.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-background/80 px-3 py-1 text-xs text-muted-foreground">
          <SearchCheck className="h-3.5 w-3.5 text-amber-700" />
          No analysis has run yet
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Business object
            </p>
            <Select
              value={scope.anchor_object_type || ''}
              onValueChange={(value) => onSetContext({ anchor_object_type: value })}
              disabled={disabled || objectOptions.length === 0}
            >
              <SelectTrigger className="w-full bg-background">
                <SelectValue placeholder="Choose an anchor object" />
              </SelectTrigger>
              <SelectContent>
                {objectOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Investigation window
            </p>
            <div className="flex flex-wrap gap-2">
              {WORKBENCH_WINDOW_PRESETS.map((preset) => {
                const selected = matchesPreset(scope.start_at, scope.end_at, preset.hours);
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => onSetContext(buildWindowPreset(preset.hours))}
                    disabled={disabled}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      selected
                        ? 'border-primary/35 bg-primary/12 text-foreground'
                        : 'border-border/70 bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            {selectedWindow ? (
              <p className="text-xs text-muted-foreground">{selectedWindow}</p>
            ) : (
              <p className="text-xs text-muted-foreground">Choose a recent time window to continue.</p>
            )}
          </div>
        </div>

        <div className="flex min-w-52 flex-col justify-between gap-3 rounded-2xl border border-border/70 bg-background/80 p-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Ready when scoped
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              You can type a follow-up after selecting scope, or rerun the original question now.
            </p>
          </div>
          <Button type="button" onClick={() => onRun(latestUserQuestion)} disabled={!canRun || disabled}>
            Run scoped investigation
          </Button>
        </div>
      </div>
    </div>
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
    sendMessage,
    isThreadRunning,
    setThreadWorkbenchContext,
  } = useSharedAssistantRuntime({
    context: {
      route,
      module: experience === 'workbench' ? 'workbench' : moduleName,
    },
    experience,
  });
  const seedPromptRef = useRef('');
  const normalizedSeedPrompt = (seedPrompt || '').trim();
  const isWorkbenchPage = variant === 'page' && experience === 'workbench';

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
      : isWorkbenchPage
        ? 'border-b border-border/70 bg-[radial-gradient(circle_at_top_left,_color-mix(in_oklch,var(--primary)_18%,transparent),transparent_38%),linear-gradient(135deg,color-mix(in_oklch,var(--background)_88%,white),color-mix(in_oklch,var(--muted)_68%,white))] px-6 py-5'
        : 'border-b px-6 py-4';
  const viewportClass =
    variant === 'panel'
      ? 'relative min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-background via-background to-muted/20 px-5 py-4'
      : isWorkbenchPage
        ? 'min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,color-mix(in_oklch,var(--background)_98%,white),color-mix(in_oklch,var(--muted)_36%,white))] px-6 py-5'
        : 'min-h-0 flex-1 overflow-y-auto px-6 py-4';
  const sidebarClass =
    variant === 'panel'
      ? 'hidden w-64 shrink-0 border-r border-border/70 bg-card/55 p-3 md:block'
      : isWorkbenchPage
        ? 'hidden w-72 shrink-0 border-r border-border/70 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--background)_94%,white),color-mix(in_oklch,var(--muted)_50%,white))] p-4 md:block'
        : 'hidden w-64 shrink-0 border-r p-3 md:block';
  const pageCardClass = isWorkbenchPage
    ? 'h-[calc(100dvh-3rem)] overflow-hidden border-border/70 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--background)_94%,white),color-mix(in_oklch,var(--muted)_40%,white))] p-0 shadow-[0_30px_90px_-48px_black]'
    : 'h-[calc(100dvh-3rem)] overflow-hidden p-0';
  const composerPlaceholder = isWorkbenchPage
    ? 'Ask an operational question in business language...'
    : 'Ask the assistant...';
  const activeThread = threads.find((thread) => thread.id === activeThreadId) || null;
  const threadRunning = activeThread ? isThreadRunning(activeThread.id) : false;
  const pendingStatus = activeThread?.pendingStatus || null;
  const latestWorkbenchTurn = activeThread
    ? [...activeThread.messages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.workbench)
        ?.workbench ?? null
    : null;
  const showClarificationPanel =
    isWorkbenchPage &&
    !!activeThread &&
    latestWorkbenchTurn?.turnKind === 'clarifying_question' &&
    !pendingStatus;
  const emptyStateTitle = isWorkbenchPage ? 'AI investigation workbench' : 'Investigation-ready assistant';
  const emptyStateCopy = isWorkbenchPage
    ? 'Start from the question. Seer will investigate, surface evidence, and make uncertainty visible.'
    : 'Grounded responses with evidence and caveats.';
  const baseContext =
    experience === 'workbench'
      ? {
          route,
          module: 'workbench',
        }
      : {
          route,
          module: moduleName,
        };

  const workspaceContent = (
    <>
      <div className={headerClass}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {variant === 'panel'
                ? 'Global Assistant'
                : isWorkbenchPage
                  ? 'Primary Investigation Surface'
                  : 'Assistant Workspace'}
            </p>
            <h2 className="mt-1 font-display text-xl leading-none">
              {isWorkbenchPage ? 'AI Investigation Workbench' : 'Atlas Copilot'}
            </h2>
            {isWorkbenchPage ? (
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Ask what changed, what is driving risk, or what deserves action next. The workbench
                investigates first, then sends you into deeper surfaces only when verification
                matters.
              </p>
            ) : null}
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/80 px-2.5 py-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              <p className="text-xs font-medium text-foreground/90">
                {isWorkbenchPage ? 'Workbench context' : `${formatModuleName(moduleName)} context`}
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
        <div className="flex min-h-0 flex-1">
          <aside className={sidebarClass}>
            {isWorkbenchPage ? (
              <div className="mb-4 rounded-2xl border border-border/70 bg-card/80 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Investigations
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Keep one thread per question or risk theme so follow-ups stay grounded in the
                  same evidence trail.
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

          <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
            <ThreadPrimitive.Viewport className={viewportClass}>
              <AuiIf condition={({ thread }) => thread.isEmpty}>
                <div className="mx-auto max-w-lg pt-6">
                  <div
                    className={`rounded-2xl border border-border/70 p-5 shadow-[0_16px_40px_-26px_black] ${
                      isWorkbenchPage
                        ? 'bg-[linear-gradient(135deg,color-mix(in_oklch,var(--card)_92%,white),color-mix(in_oklch,var(--muted)_44%,white))]'
                        : 'bg-card/70'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/16 text-primary">
                        <Sparkles className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{emptyStateTitle}</p>
                        <p className="text-xs text-muted-foreground">{emptyStateCopy}</p>
                      </div>
                    </div>
                    {isWorkbenchPage ? (
                      <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                        <div className="rounded-xl border border-border/70 bg-background/75 px-3 py-2">
                          Natural-language intake
                        </div>
                        <div className="rounded-xl border border-border/70 bg-background/75 px-3 py-2">
                          Evidence and caveats stay explicit
                        </div>
                        <div className="rounded-xl border border-border/70 bg-background/75 px-3 py-2">
                          Follow-ups preserve investigation context
                        </div>
                      </div>
                    ) : null}
                    <QuickPrompts moduleName={moduleName} experience={experience} />
                  </div>
                </div>
              </AuiIf>

              <AuiIf condition={({ thread }) => !thread.isEmpty}>
                {isWorkbenchPage && pendingStatus ? (
                  <div className="mb-4 flex items-start gap-3 rounded-2xl border border-primary/18 bg-primary/8 px-4 py-3 text-sm shadow-[0_14px_28px_-18px_var(--primary)]">
                    <LoaderCircle className="mt-0.5 h-4 w-4 animate-spin text-primary" />
                    <div>
                      <p className="font-medium text-foreground">Investigating</p>
                      <p className="text-muted-foreground">{pendingStatus}</p>
                    </div>
                  </div>
                ) : null}
                <ThreadPrimitive.Messages
                  components={{
                    UserMessage: UserMessageBubble,
                    AssistantMessage: AssistantMessageBubble,
                  }}
                />
                {showClarificationPanel && activeThread ? (
                  <WorkbenchClarificationPanel
                    thread={activeThread}
                    disabled={threadRunning}
                    onSetContext={(contextUpdate) => {
                      setThreadWorkbenchContext(activeThread.id, contextUpdate);
                    }}
                    onRun={(question) => {
                      void sendMessage(question, baseContext, 'workbench');
                    }}
                  />
                ) : null}
                <AuiIf condition={({ thread }) => thread.isRunning}>
                  <LoadingBubble />
                </AuiIf>
              </AuiIf>
            </ThreadPrimitive.Viewport>

            <div className="border-t border-border/70 bg-background/95 p-4">
              <ComposerPrimitive.Root className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-2xl border border-border/80 bg-card/80 p-2 shadow-[inset_0_1px_0_color-mix(in_oklch,var(--foreground)_8%,transparent)]">
                <ComposerPrimitive.Input
                  className="max-h-36 min-h-[3rem] w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/50"
                  placeholder={composerPlaceholder}
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
