import type { ComponentProps, ReactNode } from "react";

import styles from "@/components/assistant-patterns/assistant-patterns.module.css";
import type { AssistantThread } from "@/lib/assistant/types";

export type AssistantConversationThreadRailProps<TPayload = unknown> = ComponentProps<"nav"> & {
  threads: AssistantThread<TPayload>[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onCreateThread?: () => void;
  title?: string;
  emptyLabel?: string;
  renderThreadMeta?: (thread: AssistantThread<TPayload>) => ReactNode;
  formatTimestamp?: (value: string) => string;
};

function defaultFormatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AssistantConversationThreadRail<TPayload = unknown>({
  threads,
  activeThreadId,
  onSelectThread,
  onCreateThread,
  title = "Threads",
  emptyLabel = "No conversations yet.",
  renderThreadMeta,
  formatTimestamp = defaultFormatTimestamp,
  className,
  ...props
}: AssistantConversationThreadRailProps<TPayload>) {
  return (
    <nav className={[styles.threadRail, className].filter(Boolean).join(" ")} {...props}>
      <header className={styles.threadRailHeader}>
        <h3>{title}</h3>
        {onCreateThread ? (
          <button type="button" onClick={onCreateThread}>
            New thread
          </button>
        ) : null}
      </header>

      {threads.length === 0 ? (
        <p>{emptyLabel}</p>
      ) : (
        <ul className={styles.threadList}>
          {threads.map((thread) => {
            const isActive = thread.id === activeThreadId;
            return (
              <li key={thread.id}>
                <button
                  type="button"
                  className={styles.threadButton}
                  data-active={isActive ? "true" : "false"}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onSelectThread(thread.id)}
                >
                  <span>{thread.title}</span>
                  <small className={styles.threadMeta}>
                    {renderThreadMeta
                      ? renderThreadMeta(thread)
                      : `${thread.messages.length} messages · ${formatTimestamp(thread.updatedAt)}`}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
