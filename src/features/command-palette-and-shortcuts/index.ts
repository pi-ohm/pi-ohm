import type { FeatureDefinition } from "../../core/feature";

export const command_palette_and_shortcutsFeature: FeatureDefinition = {
  slug: "command-palette-and-shortcuts",
  name: "Command Palette + Shortcuts",
  ampFeature: "Always-available command palette replacing slash-first workflows",
  description: "Unified command launcher and keyboard shortcut layer for common workflows.",
  phase: "P0",
  status: "planned",
  path: "src/features/command-palette-and-shortcuts",
  dependsOn: [],
  sourceUrls: ["https://ampcode.com/manual", "https://ampcode.com/news/command-palette"],
};
