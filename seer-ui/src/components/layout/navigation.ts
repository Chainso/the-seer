export type AppNavigationItem = {
  href: string;
  label: string;
  description: string;
  phase: string;
};

export const appNavigation: readonly AppNavigationItem[] = [
  {
    href: "/",
    label: "Mission Control",
    description: "Platform health and module entry points.",
    phase: "Phase 0",
  },
  {
    href: "/ontology",
    label: "Ontology Explorer",
    description: "Read-only semantic graph and copilot workflows.",
    phase: "Phase 1",
  },
  {
    href: "/ingestion",
    label: "Ingestion Monitor",
    description: "Operational visibility for event and object history.",
    phase: "Phase 2",
  },
  {
    href: "/process",
    label: "Process Explorer",
    description: "Object-centric mining and trace drill-down.",
    phase: "Phase 3",
  },
  {
    href: "/root-cause",
    label: "Root-Cause Lab",
    description: "Outcome-driven hypothesis ranking and evidence review.",
    phase: "Phase 4",
  },
  {
    href: "/insights",
    label: "Guided Investigation",
    description: "Cross-module AI investigation orchestration.",
    phase: "Phase 5",
  },
];

export function isNavigationItemActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
