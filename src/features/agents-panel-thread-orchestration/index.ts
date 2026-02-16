import type { FeatureDefinition } from "../../core/feature";

export const agents_panel_thread_orchestrationFeature: FeatureDefinition = {
  slug: "agents-panel-thread-orchestration",
  name: "Agents Panel + Thread Orchestration",
  ampFeature: "UI for monitoring/managing multiple active threads",
  description: "Dashboard-like management of active threads and quick switching.",
  phase: "P1",
  status: "planned",
  path: "src/features/agents-panel-thread-orchestration",
  dependsOn: ["thread-labels-archive-and-visibility"],
  sourceUrls: ["https://ampcode.com/news/agents-panel"],
};
