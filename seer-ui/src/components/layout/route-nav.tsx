"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { appNavigation, isNavigationItemActive } from "@/components/layout/navigation";

type RouteNavProps = {
  ariaLabel: string;
  compact?: boolean;
  onNavigate?: () => void;
};

export function RouteNav({ ariaLabel, compact = false, onNavigate }: RouteNavProps) {
  const pathname = usePathname();

  return (
    <nav className={`route-nav${compact ? " route-nav-compact" : ""}`} aria-label={ariaLabel}>
      {appNavigation.map((item) => {
        const isActive = isNavigationItemActive(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className="route-link"
            data-active={isActive ? "true" : "false"}
            onClick={onNavigate}
          >
            <span className="route-link__title">{item.label}</span>
            {compact ? null : <span className="route-link__description">{item.description}</span>}
            <span className="route-link__phase">{item.phase}</span>
          </Link>
        );
      })}
    </nav>
  );
}
