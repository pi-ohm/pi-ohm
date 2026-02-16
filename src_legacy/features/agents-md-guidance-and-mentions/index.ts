import type { FeatureDefinition } from "../../core/feature";

export const agents_md_guidance_and_mentionsFeature: FeatureDefinition = {
  slug: "agents-md-guidance-and-mentions",
  name: "AGENTS.md Guidance + @Mentions",
  ampFeature: "Hierarchical AGENTS.md loading with @-mentions and globs",
  description:
    "Guidance resolution from cwd/parents/subtrees, plus referenced docs with granular globs.",
  phase: "P0",
  status: "planned",
  path: "src/features/agents-md-guidance-and-mentions",
  dependsOn: [],
  sourceUrls: ["https://ampcode.com/manual"],
};
