import type { FeatureDefinition } from "../../core/feature";

export const walkthroughs_and_clickable_diagramsFeature: FeatureDefinition = {
  slug: "walkthroughs-and-clickable-diagrams",
  name: "Walkthroughs + Clickable Diagrams",
  ampFeature: "Interactive diagrams and code-linked Mermaid nodes",
  description: "Generate shareable architecture walkthroughs with drill-down navigation.",
  phase: "P2",
  status: "planned",
  path: "src/features/walkthroughs-and-clickable-diagrams",
  dependsOn: ["librarian-remote-code-search"],
  sourceUrls: [
    "https://ampcode.com/news/walkthrough",
    "https://ampcode.com/news/clickable-diagrams",
  ],
};
