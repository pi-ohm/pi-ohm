import type { FeatureDefinition } from "../../core/feature";

export const workspace_settings_and_entitlementsFeature: FeatureDefinition = {
  slug: "workspace-settings-and-entitlements",
  name: "Workspace Settings + Entitlements",
  ampFeature: "Per-workspace settings and spend limits",
  description: "Repo-local settings + org-level spending controls / quotas.",
  phase: "P2",
  status: "planned",
  path: "src/features/workspace-settings-and-entitlements",
  dependsOn: [],
  sourceUrls: [
    "https://ampcode.com/news/cli-workspace-settings",
    "https://ampcode.com/news/workspace-entitlements",
    "https://ampcode.com/manual",
  ],
};
