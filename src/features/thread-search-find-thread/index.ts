import type { FeatureDefinition } from "../../core/feature";

export const thread_search_find_threadFeature: FeatureDefinition = {
  slug: "thread-search-find-thread",
  name: "Thread Search + find_thread",
  ampFeature: "Search threads by keyword and touched files",
  description: "Index and query session history to locate prior work quickly.",
  phase: "P1",
  status: "planned",
  path: "src/features/thread-search-find-thread",
  dependsOn: ["thread-references-read-thread"],
  sourceUrls: ["https://ampcode.com/manual", "https://ampcode.com/news/find-threads"],
};
