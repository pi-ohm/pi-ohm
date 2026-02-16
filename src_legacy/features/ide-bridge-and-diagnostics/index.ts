import type { FeatureDefinition } from "../../core/feature";

export const ide_bridge_and_diagnosticsFeature: FeatureDefinition = {
  slug: "ide-bridge-and-diagnostics",
  name: "IDE Bridge + Diagnostics",
  ampFeature: "CLI<->IDE bridge for diagnostics, file context, and edits",
  description: "Integration points for VS Code/JetBrains/Neovim/Zed contextual editing.",
  phase: "P1",
  status: "planned",
  path: "src/features/ide-bridge-and-diagnostics",
  dependsOn: [],
  sourceUrls: ["https://ampcode.com/manual"],
};
