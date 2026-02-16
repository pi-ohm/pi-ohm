import type { FeatureDefinition } from "../../core/feature";

export const look_at_media_analysisFeature: FeatureDefinition = {
  slug: "look-at-media-analysis",
  name: "Look-at Media Analysis",
  ampFeature: "Analyze PDFs/images via dedicated side model context",
  description: "Media extraction tool that keeps main context lean.",
  phase: "P1",
  status: "planned",
  path: "src/features/look-at-media-analysis",
  dependsOn: [],
  sourceUrls: ["https://ampcode.com/news/look-at", "https://ampcode.com/manual"],
};
