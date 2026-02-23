"use client";

import { useTheme } from "@/components/theme/theme-provider";

type ThemeToggleProps = {
  compact?: boolean;
};

export function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
    >
      <span className="theme-toggle__dot" aria-hidden="true" />
      {compact ? <span className="theme-toggle__text">{theme}</span> : null}
      {!compact ? <span className="theme-toggle__text">Theme: {theme}</span> : null}
    </button>
  );
}
