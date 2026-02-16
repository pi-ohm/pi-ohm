import type { FeatureDefinition } from "../../core/feature";

export const thread_references_read_threadFeature: FeatureDefinition = {
  slug: "thread-references-read-thread",
  name: "Thread References + read_thread",
  ampFeature: "Reference other threads by URL/ID and pull relevant context",
  description: "Cross-thread context import by mentioning thread URLs or IDs.",
  phase: "P0",
  status: "planned",
  path: "src/features/thread-references-read-thread",
  dependsOn: ["handoff-and-auto-handoff"],
  sourceUrls: ["https://ampcode.com/manual", "https://ampcode.com/news/read-threads"],
};
