export const PHM_FEATURE_PACKAGES = [
  "@pi-phm/handoff",
  "@pi-phm/subagents",
  "@pi-phm/session-search",
  "@pi-phm/painter",
] as const;

export const PHM_RECOMMENDED_NEXT = [
  {
    name: "Modes (rush/smart/deep)",
    reason: "Switch quality/speed profile without reconfiguring every feature package.",
  },
  {
    name: "Permissions policy layer",
    reason: "Protect against unsafe delegated command execution in subagent workflows.",
  },
  {
    name: "Skills + MCP lazy loading",
    reason: "Keep tool/context footprint manageable as the package set grows.",
  },
] as const;
