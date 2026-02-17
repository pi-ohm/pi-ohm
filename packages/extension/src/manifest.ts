export const PHM_FEATURE_PACKAGES = [
  "@pi-ohm/modes",
  "@pi-ohm/handoff",
  "@pi-ohm/subagents",
  "@pi-ohm/session-search",
  "@pi-ohm/painter",
] as const;

export const PHM_RECOMMENDED_NEXT = [
  {
    name: "Permissions policy layer",
    reason: "Protect against unsafe delegated command execution in subagent workflows.",
  },
  {
    name: "Skills + MCP lazy loading",
    reason: "Keep tool/context footprint manageable as the package set grows.",
  },
] as const;
