import type { FeatureDefinition } from "../core/feature";

export type OhmMode = "rush" | "smart" | "deep" | "large";

export interface OhmConfig {
  defaultMode: OhmMode;
  enabledModes: OhmMode[];
  enabledFeatures: string[];
  experimentalFeatures: string[];
  subagentBackend: "none" | "interactive-shell" | "custom-plugin";
}

export function buildDefaultConfig(features: FeatureDefinition[]): OhmConfig {
  const p0Features = features
    .filter((feature) => feature.phase === "P0")
    .map((feature) => feature.slug);

  return {
    defaultMode: "smart",
    enabledModes: ["rush", "smart", "deep"],
    enabledFeatures: p0Features,
    experimentalFeatures: ["modes-smart-rush-deep-large", "subagents-task-delegation"],
    subagentBackend: "interactive-shell",
  };
}
