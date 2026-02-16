import type { FeatureDefinition } from "../../core/feature";

export const oracle_second_opinionFeature: FeatureDefinition = {
  slug: "oracle-second-opinion",
  name: "Oracle Second Opinion",
  ampFeature: "Secondary reasoning model for planning/debugging/review",
  description: "Escalation path to stronger reasoning model/tool for difficult tasks.",
  phase: "P1",
  status: "planned",
  path: "src/features/oracle-second-opinion",
  dependsOn: ["subagents-task-delegation"],
  sourceUrls: ["https://ampcode.com/manual", "https://ampcode.com/news/gpt-5-oracle"],
};
