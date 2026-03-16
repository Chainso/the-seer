const MANAGED_AGENT_ACTION_PREFIX = "urn:seer:managed-agent:";

export type ManagedAgentTab = "details" | "runs";

export function buildManagedAgentsIndexHref(): string {
  return "/inspector/managed-agents";
}

export function buildManagedAgentNewHref(): string {
  return "/inspector/managed-agents/new";
}

export function buildManagedAgentHref(managedAgentKey: string): string {
  return `/inspector/managed-agents/${managedAgentKey}`;
}

export function buildManagedAgentEditHref(managedAgentKey: string): string {
  return `${buildManagedAgentHref(managedAgentKey)}/edit`;
}

export function buildManagedAgentRunsHref(managedAgentKey: string): string {
  return `${buildManagedAgentHref(managedAgentKey)}?tab=runs`;
}

export function buildManagedAgentRunHref(
  managedAgentKey: string,
  executionId: string
): string {
  return `${buildManagedAgentHref(managedAgentKey)}/runs/${executionId}`;
}

export function managedAgentKeyFromActionUri(actionUri: string): string | null {
  return actionUri.startsWith(MANAGED_AGENT_ACTION_PREFIX)
    ? actionUri.slice(MANAGED_AGENT_ACTION_PREFIX.length)
    : null;
}

export function normalizeManagedAgentTab(value: string | null | undefined): ManagedAgentTab {
  return value === "runs" ? "runs" : "details";
}
