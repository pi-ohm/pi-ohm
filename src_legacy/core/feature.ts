export type FeaturePhase = "P0" | "P1" | "P2";
export type FeatureStatus = "planned" | "prototype" | "in-progress" | "done";

export interface FeatureDefinition {
  slug: string;
  name: string;
  ampFeature: string;
  description: string;
  phase: FeaturePhase;
  status: FeatureStatus;
  path: `src/features/${string}`;
  dependsOn: string[];
  sourceUrls: string[];
}
