import type { FeatureDefinition } from "../../core/feature";

export const permissions_policy_engineFeature: FeatureDefinition = {
  slug: "permissions-policy-engine",
  name: "Permissions Policy Engine",
  ampFeature: "Allow/ask/reject/delegate tool permission rules",
  description: "Rule engine for secure tool execution with optional external delegates.",
  phase: "P0",
  status: "planned",
  path: "src/features/permissions-policy-engine",
  dependsOn: [],
  sourceUrls: ["https://ampcode.com/manual"],
};
