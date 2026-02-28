'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { Textarea } from '@/app/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { Sparkles, ShieldCheck, Wrench, Siren, GitPullRequest, ShieldAlert } from 'lucide-react';
import { redactEvidenceRefs, redactSensitiveText } from '@/app/lib/security-redaction';
import { generateAssistantBrief } from '@/app/lib/api/assistant';
import type {
  AssistantConversationMessage,
  AssistantConversationThread,
  AssistantMode,
  AssistantResponseContract,
} from '@/app/types/assistant';

const ASSISTANT_SAFE_MODE_KEY = 'seer_assistant_safe_mode_v1';
const ASSISTANT_CONVERSATION_KEY = 'seer_assistant_conversation_v1';
const ASSISTANT_CONVERSATIONS_KEY = 'seer_assistant_conversations_v2';
const ASSISTANT_ACTIVE_CONVERSATION_ID_KEY = 'seer_assistant_active_conversation_id_v1';

const MODE_META: Record<AssistantMode, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  explain: { label: 'Explain', icon: Sparkles },
  review: { label: 'Review', icon: GitPullRequest },
  incident: { label: 'Incident', icon: Siren },
  optimize: { label: 'Optimize', icon: Wrench },
};

const PROMPT_HINTS: Record<AssistantMode, string> = {
  explain: 'Explain this ontology area in business terms',
  review: 'Summarize semantic risk in this change',
  incident: 'Why is this process degrading right now?',
  optimize: 'Which intervention has highest expected impact?',
};

function newConversationTitle(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return 'New Conversation';
  }
  return trimmed.length <= 52 ? trimmed : `${trimmed.slice(0, 52)}...`;
}

function createEmptyConversation(now: string): AssistantConversationThread {
  return {
    id: `conversation-${Date.now()}`,
    title: 'New Conversation',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function MissionControlPanel() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const [mode, setMode] = useState<AssistantMode>('explain');
  const [query, setQuery] = useState(initialQuery);
  const [conversations, setConversations] = useState<AssistantConversationThread[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [safeMode, setSafeMode] = useState<boolean>(true);
  const [persistedStateLoaded, setPersistedStateLoaded] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const promptPlaceholder = useMemo(() => PROMPT_HINTS[mode], [mode]);
  const activeConversation = useMemo(
    () => conversations.find((thread) => thread.id === activeConversationId) || null,
    [conversations, activeConversationId]
  );
  const conversation = useMemo(
    () => activeConversation?.messages ?? [],
    [activeConversation]
  );

  const validateResult = (candidate: AssistantResponseContract) =>
    candidate.evidence.length > 0 &&
    candidate.answer.trim().length > 0 &&
    candidate.nextActions.length > 0 &&
    candidate.modePayload.bullets.length > 0;

  useEffect(() => {
    let initialConversations: AssistantConversationThread[] = [];
    const rawConversations = localStorage.getItem(ASSISTANT_CONVERSATIONS_KEY);
    if (rawConversations) {
      try {
        const parsed = JSON.parse(rawConversations) as AssistantConversationThread[];
        if (Array.isArray(parsed)) {
          initialConversations = parsed
            .filter((thread) => thread && typeof thread.id === 'string' && Array.isArray(thread.messages))
            .map((thread) => ({
              id: thread.id,
              title: typeof thread.title === 'string' && thread.title.trim() ? thread.title : 'Conversation',
              createdAt: thread.createdAt || new Date().toISOString(),
              updatedAt: thread.updatedAt || thread.createdAt || new Date().toISOString(),
              messages: thread.messages,
            }));
        }
      } catch {
        // Ignore malformed persisted conversation data.
      }
    }

    if (initialConversations.length === 0) {
      const rawLegacyConversation = localStorage.getItem(ASSISTANT_CONVERSATION_KEY);
      if (rawLegacyConversation) {
        try {
          const parsed = JSON.parse(rawLegacyConversation) as AssistantConversationMessage[];
          if (Array.isArray(parsed)) {
            const now = new Date().toISOString();
            initialConversations = [
              {
                id: `conversation-${Date.now()}`,
                title: 'Conversation 1',
                createdAt: now,
                updatedAt: now,
                messages: parsed,
              },
            ];
          }
        } catch {
          // Ignore malformed legacy conversation data.
        }
      }
    }

    if (initialConversations.length === 0) {
      const now = new Date().toISOString();
      initialConversations = [createEmptyConversation(now)];
    }

    initialConversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setConversations(initialConversations);

    const rawActiveConversationId = localStorage.getItem(ASSISTANT_ACTIVE_CONVERSATION_ID_KEY);
    const activeId = rawActiveConversationId && initialConversations.some((thread) => thread.id === rawActiveConversationId)
      ? rawActiveConversationId
      : initialConversations[0]?.id ?? null;
    setActiveConversationId(activeId);

    const rawSafeMode = localStorage.getItem(ASSISTANT_SAFE_MODE_KEY);
    if (rawSafeMode) {
      setSafeMode(rawSafeMode === 'true');
    }
    setPersistedStateLoaded(true);
  }, []);

  useEffect(() => {
    if (!persistedStateLoaded) {
      return;
    }
    localStorage.setItem(ASSISTANT_CONVERSATIONS_KEY, JSON.stringify(conversations));
  }, [conversations, persistedStateLoaded]);

  useEffect(() => {
    if (!persistedStateLoaded || !activeConversationId) {
      return;
    }
    localStorage.setItem(ASSISTANT_ACTIVE_CONVERSATION_ID_KEY, activeConversationId);
  }, [activeConversationId, persistedStateLoaded]);

  useEffect(() => {
    if (!persistedStateLoaded) {
      return;
    }
    localStorage.setItem(ASSISTANT_SAFE_MODE_KEY, String(safeMode));
  }, [safeMode, persistedStateLoaded]);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [conversation, running]);

  const updateConversationMessages = (
    conversationId: string,
    updater: (messages: AssistantConversationMessage[]) => AssistantConversationMessage[],
    options?: { titleFromPrompt?: string }
  ) => {
    setConversations((prev) =>
      prev
        .map((thread) => {
          if (thread.id !== conversationId) {
            return thread;
          }
          const nextMessages = updater(thread.messages);
          const nextTitle =
            thread.title === 'New Conversation' && options?.titleFromPrompt
              ? newConversationTitle(options.titleFromPrompt)
              : thread.title;
          return {
            ...thread,
            title: nextTitle,
            updatedAt: new Date().toISOString(),
            messages: nextMessages.slice(-80),
          };
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    );
  };

  const createNewConversation = () => {
    const now = new Date().toISOString();
    const thread = createEmptyConversation(now);
    setConversations((prev) => [thread, ...prev]);
    setActiveConversationId(thread.id);
    setError(null);
    setQuery('');
  };

  const runAssistant = async () => {
    const prompt = query.trim();
    if (!prompt) {
      setError('Enter a question or objective for the assistant.');
      return;
    }
    const targetConversationId = activeConversationId;
    if (!targetConversationId) {
      setError('Create a conversation first.');
      return;
    }
    setQuery('');
    setError(null);
    setRunning(true);

    try {
      const now = new Date().toISOString();
      const userMessage: AssistantConversationMessage = {
        id: `conversation-user-${Date.now()}`,
        at: now,
        role: 'user',
        content: prompt,
      };
      const conversationForRequest = [...conversation, userMessage].map((message) => ({
        role: message.role,
        content: message.content,
      }));
      updateConversationMessages(
        targetConversationId,
        (messages) => [...messages, userMessage],
        { titleFromPrompt: prompt }
      );
      const nextResult = await generateAssistantBrief({
        mode,
        prompt,
        conversation: conversationForRequest,
      });

      if (!validateResult(nextResult)) {
        setError('Assistant response blocked: evidence metadata is required.');
        return;
      }

      const assistantMessage: AssistantConversationMessage = {
        id: `conversation-assistant-${Date.now()}`,
        at: new Date().toISOString(),
        role: 'assistant',
        content: nextResult.answer,
        mode,
        response: nextResult,
      };
      updateConversationMessages(targetConversationId, (messages) => [...messages, assistantMessage]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Assistant request failed';
      setError(`Assistant request failed: ${detail}`);
    } finally {
      setRunning(false);
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!running) {
        void runAssistant();
      }
    }
  };

  const displayedConversation = useMemo(
    () =>
      conversation.map((message) => {
        if (!safeMode || message.role !== 'assistant' || !message.response) {
          return message;
        }
        return {
          ...message,
          content: redactSensitiveText(message.content).value,
          response: {
            ...message.response,
            answer: redactSensitiveText(message.response.answer).value,
            evidence: redactEvidenceRefs(message.response.evidence).value,
          },
        };
      }),
    [conversation, safeMode]
  );

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Assistant</p>
            <h1 className="mt-3 font-display text-3xl">Mission Control</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Run explain, review, incident, and optimization workflows with evidence-linked outputs.
            </p>
          </div>
          <Badge className="gap-2 rounded-full bg-muted px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em]">
            <ShieldCheck className="h-3 w-3" />
            Evidence required
          </Badge>
        </div>
        <div className="mt-4">
          <Button
            variant={safeMode ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setSafeMode((prev) => !prev)}
            className="gap-2"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            {safeMode ? 'Safe mode on (redaction active)' : 'Safe mode off'}
          </Button>
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="assistant-conversation" className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Conversation
            </label>
            <select
              id="assistant-conversation"
              value={activeConversationId ?? ''}
              onChange={(event) => {
                setActiveConversationId(event.target.value);
                setError(null);
              }}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            >
              {conversations.map((thread) => (
                <option key={thread.id} value={thread.id}>
                  {thread.title}
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={createNewConversation}>
              New Conversation
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <Tabs value={mode} onValueChange={(value) => setMode(value as AssistantMode)}>
            <TabsList className="h-10">
              {(Object.keys(MODE_META) as AssistantMode[]).map((modeKey) => {
                const Icon = MODE_META[modeKey].icon;
                return (
                  <TabsTrigger key={modeKey} value={modeKey}>
                    <Icon className="mr-1 h-3.5 w-3.5" />
                    {MODE_META[modeKey].label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{displayedConversation.length} messages</Badge>
          </div>
        </div>

        <div
          ref={chatScrollRef}
          className="mt-4 h-[520px] space-y-3 overflow-y-auto rounded-xl border border-border bg-background/40 p-3"
        >
          {displayedConversation.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Start a conversation. Your messages and the assistant responses stay in one thread.
            </p>
          )}
          {displayedConversation.map((message) => {
            const isUser = message.role === 'user';
            return (
              <div
                key={message.id}
                className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl border px-4 py-3 ${
                    isUser
                      ? 'border-primary/40 bg-primary/10'
                      : 'border-border bg-card'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant={isUser ? 'secondary' : 'outline'}>
                      {isUser ? 'You' : MODE_META[message.mode ?? mode].label}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(message.at).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{message.content}</p>

                  {!isUser && message.response && (
                    <div className="mt-3 space-y-3">
                      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          {message.response.modePayload.title}
                        </p>
                        <div className="mt-2 space-y-1">
                          {message.response.modePayload.bullets.map((bullet, index) => (
                            <p key={`${message.id}-bullet-${index}`} className="text-xs text-muted-foreground">
                              - {bullet}
                            </p>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Next Actions
                        </p>
                        <div className="mt-2 space-y-1">
                          {message.response.nextActions.map((action, index) => (
                            <p key={`${message.id}-action-${index}`} className="text-xs text-muted-foreground">
                              {index + 1}. {action}
                            </p>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-md border border-border px-2 py-1">
                          confidence {(message.response.confidence * 100).toFixed(0)}%
                        </span>
                        <span className="rounded-md border border-border px-2 py-1">
                          {message.response.uncertainty}
                        </span>
                      </div>

                      <div className="space-y-1">
                        {message.response.evidence.map((item) => (
                          <Link
                            key={`${message.id}-${item.conceptUri}`}
                            href={`/ontology/overview?conceptUri=${encodeURIComponent(item.conceptUri)}`}
                            className="block rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                          >
                            <span className="font-medium">{item.label}</span>
                            <span className="ml-2 text-muted-foreground">{item.source}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {running && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                Assistant is generating a response...
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 space-y-2">
          <Textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={promptPlaceholder}
            className="min-h-[88px]"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Enter to send, Shift+Enter for newline</p>
            <Button onClick={runAssistant} disabled={running || !query.trim()}>
              {running ? 'Generating...' : 'Send'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
