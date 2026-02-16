import type { FeatureDefinition } from "../../core/feature";

export const librarian_remote_code_searchFeature: FeatureDefinition = {
  slug: "librarian-remote-code-search",
  name: "Librarian Remote Code Search",
  ampFeature: "Cross-repo code search and explanation subagent",
  description: "Remote repository research across public/private code hosts.",
  phase: "P1",
  status: "planned",
  path: "src/features/librarian-remote-code-search",
  dependsOn: ["subagents-task-delegation"],
  sourceUrls: ["https://ampcode.com/manual", "https://ampcode.com/news/librarian"],
};
