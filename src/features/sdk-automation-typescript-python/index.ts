import type { FeatureDefinition } from "../../core/feature";

export const sdk_automation_typescript_pythonFeature: FeatureDefinition = {
  slug: "sdk-automation-typescript-python",
  name: "SDK Automation (TS/Python)",
  ampFeature: "Programmatic execution through SDKs",
  description: "Headless SDK invocation patterns and event-stream handling.",
  phase: "P2",
  status: "planned",
  path: "src/features/sdk-automation-typescript-python",
  dependsOn: ["cli-execute-mode-and-stream-json"],
  sourceUrls: ["https://ampcode.com/news/python-sdk", "https://ampcode.com/manual"],
};
