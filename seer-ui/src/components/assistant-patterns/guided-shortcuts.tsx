import Link from "next/link";
import type { ComponentProps } from "react";

import styles from "@/components/assistant-patterns/assistant-patterns.module.css";
import type { GuidedInvestigationShortcutLink } from "@/lib/assistant/types";

export type AssistantGuidedShortcutsProps = ComponentProps<"section"> & {
  links: GuidedInvestigationShortcutLink[];
  title?: string;
  description?: string;
  emptyLabel?: string;
};

export function AssistantGuidedShortcuts({
  links,
  title = "Guided Investigation Shortcuts",
  description = "Move module context into the primary AI-first investigation workflow.",
  emptyLabel = "No module shortcuts are available for this context.",
  className,
  ...props
}: AssistantGuidedShortcutsProps) {
  return (
    <section className={className} {...props}>
      <header>
        <h3>{title}</h3>
        <p>{description}</p>
      </header>

      {links.length === 0 ? (
        <p>{emptyLabel}</p>
      ) : (
        <ul className={styles.shortcutList}>
          {links.map((shortcut) => (
            <li key={shortcut.id}>
              <Link href={shortcut.href}>{shortcut.label}</Link>
              <p>{shortcut.description}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
