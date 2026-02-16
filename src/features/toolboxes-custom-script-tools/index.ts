import type { FeatureDefinition } from "../../core/feature";

export const toolboxes_custom_script_toolsFeature: FeatureDefinition = {
  slug: "toolboxes-custom-script-tools",
  name: "Toolboxes (Custom Script Tools)",
  ampFeature: "AMP_TOOLBOX executable tool protocol",
  description: "Simple deterministic tool integration via executable scripts.",
  phase: "P1",
  status: "planned",
  path: "src/features/toolboxes-custom-script-tools",
  dependsOn: [],
  sourceUrls: ["https://ampcode.com/manual", "https://ampcode.com/news/toolboxes"],
};
