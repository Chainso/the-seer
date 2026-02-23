"use client";

import type { ComponentProps } from "react";

import styles from "@/components/assistant-patterns/assistant-patterns.module.css";

export type AssistantSafeModeToggleProps = Omit<ComponentProps<"button">, "onChange"> & {
  safeMode: boolean;
  onSafeModeChange: (next: boolean) => void;
  enabledLabel?: string;
  disabledLabel?: string;
};

export function AssistantSafeModeToggle({
  safeMode,
  onSafeModeChange,
  enabledLabel = "Safe mode on (redaction active)",
  disabledLabel = "Safe mode off",
  className,
  type,
  ...props
}: AssistantSafeModeToggleProps) {
  const label = safeMode ? enabledLabel : disabledLabel;

  return (
    <button
      type={type ?? "button"}
      aria-pressed={safeMode}
      className={[styles.safeModeToggle, className].filter(Boolean).join(" ")}
      onClick={() => onSafeModeChange(!safeMode)}
      {...props}
    >
      <span className={styles.safeModeDot} data-on={safeMode ? "true" : "false"} aria-hidden="true" />
      {label}
    </button>
  );
}
