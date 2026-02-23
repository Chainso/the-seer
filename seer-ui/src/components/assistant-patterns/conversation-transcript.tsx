import type { ComponentProps, ReactNode } from "react";

import styles from "@/components/assistant-patterns/assistant-patterns.module.css";
import type { AssistantMessage } from "@/lib/assistant/types";

export type AssistantConversationTranscriptProps<TPayload = unknown> = ComponentProps<"div"> & {
  messages: AssistantMessage<TPayload>[];
  emptyLabel?: string;
  userLabel?: string;
  assistantLabel?: string;
  renderPayload?: (message: AssistantMessage<TPayload>) => ReactNode;
  formatTimestamp?: (value: string) => string;
};

function defaultFormatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AssistantConversationTranscript<TPayload = unknown>({
  messages,
  emptyLabel = "Start a conversation to capture assistant context over time.",
  userLabel = "You",
  assistantLabel = "Assistant",
  renderPayload,
  formatTimestamp = defaultFormatTimestamp,
  className,
  ...props
}: AssistantConversationTranscriptProps<TPayload>) {
  return (
    <div
      className={[styles.transcript, className].filter(Boolean).join(" ")}
      aria-live="polite"
      {...props}
    >
      {messages.length === 0 ? <p className={styles.transcriptEmpty}>{emptyLabel}</p> : null}

      {messages.map((message) => {
        const roleLabel = message.role === "user" ? userLabel : assistantLabel;
        return (
          <article key={message.id} className={styles.transcriptMessage} data-role={message.role}>
            <header className={styles.transcriptHeader}>
              <strong>{roleLabel}</strong>
              <small>{formatTimestamp(message.at)}</small>
            </header>
            <p className={styles.transcriptBody}>{message.content}</p>
            {renderPayload ? renderPayload(message) : null}
          </article>
        );
      })}
    </div>
  );
}
