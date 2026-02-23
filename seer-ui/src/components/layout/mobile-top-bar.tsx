"use client";

import Link from "next/link";
import { useState } from "react";

import { RouteNav } from "@/components/layout/route-nav";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export function MobileTopBar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="mobile-topbar">
      <div className="mobile-topbar__row">
        <Link href="/" className="mobile-topbar__brand" onClick={() => setIsOpen(false)}>
          Seer
        </Link>
        <div className="mobile-topbar__actions">
          <ThemeToggle compact />
          <button
            type="button"
            className="mobile-topbar__menu"
            aria-expanded={isOpen}
            aria-controls="mobile-route-drawer"
            onClick={() => setIsOpen((previous) => !previous)}
          >
            Menu
          </button>
        </div>
      </div>

      {isOpen ? (
        <div id="mobile-route-drawer" className="mobile-topbar__drawer">
          <RouteNav
            ariaLabel="Mobile navigation"
            compact
            onNavigate={() => {
              setIsOpen(false);
            }}
          />
        </div>
      ) : null}
    </header>
  );
}
