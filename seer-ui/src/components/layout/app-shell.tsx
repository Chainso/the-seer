import type { ReactNode } from "react";

import { MobileTopBar } from "@/components/layout/mobile-top-bar";
import { NavSidebar } from "@/components/layout/nav-sidebar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-frame">
      <a href="#seer-main-content" className="skip-link">
        Skip to main content
      </a>
      <NavSidebar />
      <div className="app-workspace">
        <MobileTopBar />
        <div id="seer-main-content" className="app-content">
          {children}
        </div>
      </div>
    </div>
  );
}
