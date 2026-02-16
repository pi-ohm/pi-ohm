import type { FeatureDefinition } from "../../core/feature";

export const handoff_and_auto_handoffFeature: FeatureDefinition = {
  slug: "handoff-and-auto-handoff",
  name: "Handoff + Auto-handoff",
  ampFeature: "Goal-directed handoff replacing compaction",
  description:
    "Manual and agent-triggered handoff for focused thread continuation with context transfer.",
  phase: "P0",
  status: "planned",
  path: "src/features/handoff-and-auto-handoff",
  dependsOn: ["agents-md-guidance-and-mentions"],
  sourceUrls: [
    "https://ampcode.com/manual",
    "https://ampcode.com/news/handoff",
    "https://ampcode.com/news/ask-to-handoff",
  ],
};
