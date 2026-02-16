import type { FeatureDefinition } from "../../core/feature";

export const subagents_task_delegationFeature: FeatureDefinition = {
  slug: "subagents-task-delegation",
  name: "Subagents / Task Delegation",
  ampFeature: "Task tool for isolated subagent execution",
  description: "Pluggable delegation interface (external CLI/plugin based for Pi).",
  phase: "P0",
  status: "planned",
  path: "src/features/subagents-task-delegation",
  dependsOn: [],
  sourceUrls: ["https://ampcode.com/manual"],
};
