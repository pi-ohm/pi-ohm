import type { FeatureDefinition } from "../../core/feature";

export const usage_cost_and_social_sharingFeature: FeatureDefinition = {
  slug: "usage-cost-and-social-sharing",
  name: "Usage Cost + Social Sharing",
  ampFeature: "Usage/cost telemetry and public thread/profile workflows",
  description: "Cost observability and optional social coding primitives.",
  phase: "P2",
  status: "planned",
  path: "src/features/usage-cost-and-social-sharing",
  dependsOn: [],
  sourceUrls: ["https://ampcode.com/manual", "https://ampcode.com/news/social-coding"],
};
