import type { FeatureDefinition } from "../../core/feature";

export const cli_execute_mode_and_stream_jsonFeature: FeatureDefinition = {
  slug: "cli-execute-mode-and-stream-json",
  name: "CLI Execute Mode + Stream JSON",
  ampFeature: "Headless execution and machine-readable streaming output",
  description: "Automation-friendly CLI mode for scripts/CI integrations.",
  phase: "P1",
  status: "planned",
  path: "src/features/cli-execute-mode-and-stream-json",
  dependsOn: [],
  sourceUrls: ["https://ampcode.com/manual"],
};
