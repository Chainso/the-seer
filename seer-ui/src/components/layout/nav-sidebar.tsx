import Link from "next/link";

import { RouteNav } from "@/components/layout/route-nav";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export function NavSidebar() {
  return (
    <aside className="app-sidebar" aria-label="Seer navigation">
      <div className="sidebar-brand">
        <Link href="/" className="sidebar-brand__link">
          <p className="sidebar-brand__kicker">Seer</p>
          <p className="sidebar-brand__title">Experience Replatform</p>
        </Link>
      </div>

      <RouteNav ariaLabel="Primary routes" />

      <div className="sidebar-footer">
        <p className="sidebar-footer__title">Display Theme</p>
        <ThemeToggle />
        <p className="sidebar-footer__text">
          Ontology remains read-only in Seer while backend contracts stay canonical.
        </p>
      </div>
    </aside>
  );
}
