"use client";

import { useId, type ComponentProps, type FormEvent, type KeyboardEvent } from "react";

import styles from "@/components/assistant-patterns/assistant-patterns.module.css";

export type AssistantConversationComposerProps = Omit<ComponentProps<"form">, "onSubmit"> & {
  value: string;
  onValueChange: (value: string) => void;
  onSubmitPrompt: (prompt: string) => void | Promise<void>;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  submitLabel?: string;
  busyLabel?: string;
  quickPrompts?: string[];
  onQuickPrompt?: (prompt: string) => void;
};

export function AssistantConversationComposer({
  value,
  onValueChange,
  onSubmitPrompt,
  disabled = false,
  label = "Ask assistant",
  placeholder = "Enter to send, Shift+Enter for newline.",
  submitLabel = "Send",
  busyLabel = "Sending...",
  quickPrompts,
  onQuickPrompt,
  className,
  ...props
}: AssistantConversationComposerProps) {
  const textareaId = useId();

  function submitPrompt(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const prompt = value.trim();
    if (!prompt || disabled) {
      return;
    }
    void onSubmitPrompt(prompt);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const prompt = value.trim();
      if (!prompt || disabled) {
        return;
      }
      void onSubmitPrompt(prompt);
    }
  }

  return (
    <form className={[styles.composerForm, className].filter(Boolean).join(" ")} onSubmit={submitPrompt} {...props}>
      {quickPrompts && quickPrompts.length > 0 ? (
        <div className={styles.quickPrompts}>
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (onQuickPrompt) {
                  onQuickPrompt(prompt);
                  return;
                }
                onValueChange(prompt);
                void onSubmitPrompt(prompt);
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      <label htmlFor={textareaId} className="field-label">
        {label}
      </label>
      <textarea
        id={textareaId}
        rows={4}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={onKeyDown}
      />

      <div className={styles.composerActions}>
        <p className={styles.composerHint}>Enter sends, Shift+Enter creates a new line.</p>
        <button type="submit" disabled={disabled || !value.trim()}>
          {disabled ? busyLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
