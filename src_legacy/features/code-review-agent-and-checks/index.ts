import type { FeatureDefinition } from "../../core/feature";

export const code_review_agent_and_checksFeature: FeatureDefinition = {
  slug: "code-review-agent-and-checks",
  name: "Code Review Agent + Checks",
  ampFeature: "Composable review agent with check-specific subagents",
  description: "Diff review workflows, CLI/editor entrypoints, and .agents/checks policy packs.",
  phase: "P0",
  status: "planned",
  path: "src/features/code-review-agent-and-checks",
  dependsOn: ["subagents-task-delegation"],
  sourceUrls: ["https://ampcode.com/manual", "https://ampcode.com/news/review", "https://ampcode.com/news/agentic-code-review", "https://ampcode.com/news/liberating-code-review"],
};
