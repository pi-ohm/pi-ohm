import type { FeatureDefinition } from "../../core/feature";

export const painter_image_generation_and_editingFeature: FeatureDefinition = {
  slug: "painter-image-generation-and-editing",
  name: "Painter Image Generation + Editing",
  ampFeature: "Generate/edit images from prompts and references",
  description: "Image creation, redaction, and iterative design support.",
  phase: "P2",
  status: "planned",
  path: "src/features/painter-image-generation-and-editing",
  dependsOn: [],
  sourceUrls: ["https://ampcode.com/news/painter", "https://ampcode.com/manual"],
};
