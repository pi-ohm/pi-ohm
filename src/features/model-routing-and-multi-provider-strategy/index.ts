import type { FeatureDefinition } from "../../core/feature";

export const model_routing_and_multi_provider_strategyFeature: FeatureDefinition = {
  slug: "model-routing-and-multi-provider-strategy",
  name: "Model Routing + Multi-provider Strategy",
  ampFeature: "Multi-model routing by task type and mode",
  description: "Provider-aware routing defaults for quality/speed/cost tradeoffs.",
  phase: "P0",
  status: "planned",
  path: "src/features/model-routing-and-multi-provider-strategy",
  dependsOn: ["modes-smart-rush-deep-large"],
  sourceUrls: ["https://ampcode.com/manual"],
};
