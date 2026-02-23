import type { AssistantMessage, AssistantMessageRole, AssistantThread } from "@/lib/assistant/types";

type ThreadUpdateOptions = {
  maxMessages?: number;
  titleSeed?: string;
};

const DEFAULT_MAX_MESSAGES = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function makeAssistantThreadId(prefix = "assistant-thread"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeAssistantMessageId(role: AssistantMessageRole, prefix = "assistant-message"): string {
  return `${prefix}-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildAssistantThreadTitle(prompt: string, maxLength = 56): string {
  const compact = prompt.trim().replace(/\s+/g, " ");
  if (!compact) {
    return "New thread";
  }
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength)}...`;
}

export function createAssistantThread(title = "New thread", now = new Date().toISOString()): AssistantThread {
  return {
    id: makeAssistantThreadId(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function sortAssistantThreads<TPayload>(threads: AssistantThread<TPayload>[]): AssistantThread<TPayload>[] {
  return [...threads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function parseAssistantRole(value: unknown): AssistantMessageRole {
  return value === "assistant" ? "assistant" : "user";
}

function parseAssistantMessage(value: unknown): AssistantMessage {
  if (!isRecord(value)) {
    const now = new Date().toISOString();
    return {
      id: makeAssistantMessageId("assistant"),
      role: "assistant",
      content: "",
      at: now,
    };
  }

  const now = new Date().toISOString();

  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : makeAssistantMessageId("assistant"),
    role: parseAssistantRole(value.role),
    content: typeof value.content === "string" ? value.content : "",
    at: typeof value.at === "string" && value.at.trim() ? value.at : now,
    payload: value.payload,
  };
}

export function parseStoredAssistantThreads(raw: string | null): AssistantThread[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalized = parsed
      .filter((entry) => isRecord(entry))
      .map((entry): AssistantThread => {
        const now = new Date().toISOString();
        const messages = Array.isArray(entry.messages)
          ? entry.messages.map(parseAssistantMessage)
          : [];

        return {
          id:
            typeof entry.id === "string" && entry.id.trim()
              ? entry.id
              : makeAssistantThreadId(),
          title:
            typeof entry.title === "string" && entry.title.trim()
              ? entry.title
              : "Conversation",
          createdAt:
            typeof entry.createdAt === "string" && entry.createdAt.trim()
              ? entry.createdAt
              : now,
          updatedAt:
            typeof entry.updatedAt === "string" && entry.updatedAt.trim()
              ? entry.updatedAt
              : typeof entry.createdAt === "string" && entry.createdAt.trim()
                ? entry.createdAt
                : now,
          messages,
        };
      });

    return sortAssistantThreads(normalized);
  } catch {
    return [];
  }
}

export function resolveAssistantActiveThreadId<TPayload>(
  threads: AssistantThread<TPayload>[],
  candidateId: string | null
): string {
  if (candidateId && threads.some((thread) => thread.id === candidateId)) {
    return candidateId;
  }
  return threads[0]?.id ?? "";
}

export function updateAssistantThreadMessages<TPayload>(
  threads: AssistantThread<TPayload>[],
  threadId: string,
  updater: (messages: AssistantMessage<TPayload>[]) => AssistantMessage<TPayload>[],
  options?: ThreadUpdateOptions
): AssistantThread<TPayload>[] {
  const maxMessages = options?.maxMessages ?? DEFAULT_MAX_MESSAGES;

  const updated = threads.map((thread) => {
    if (thread.id !== threadId) {
      return thread;
    }

    const nextMessages = updater(thread.messages).slice(-Math.max(1, maxMessages));
    const nextTitle =
      thread.title === "New thread" && options?.titleSeed
        ? buildAssistantThreadTitle(options.titleSeed)
        : thread.title;

    return {
      ...thread,
      title: nextTitle,
      updatedAt: new Date().toISOString(),
      messages: nextMessages,
    };
  });

  return sortAssistantThreads(updated);
}
