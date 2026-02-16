import type { FeatureDefinition } from "../../core/feature";

export const thread_map_visualizationFeature: FeatureDefinition = {
  slug: "thread-map-visualization",
  name: "Thread Map Visualization",
  ampFeature: "Map of related threads (handoff, mentions, forks)",
  description: "Graph view for thread lineage and navigation patterns.",
  phase: "P1",
  status: "planned",
  path: "src/features/thread-map-visualization",
  dependsOn: ["thread-references-read-thread", "handoff-and-auto-handoff"],
  sourceUrls: ["https://ampcode.com/news/thread-map"],
};
