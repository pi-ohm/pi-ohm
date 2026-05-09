import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import {
  extensionConfigModule,
  featuresConfigModule,
  isExtensionRuntimeConfig,
  isFeatureFlags,
  loadConfig,
  painterConfigModule,
  pickConfig,
} from "@pi-ohm/core/config";
import registerHandoffExtension from "@pi-ohm/handoff";
import registerSubagentsExtension from "@pi-ohm/subagents";
import registerSessionSearchExtension from "@pi-ohm/session-search";
import registerPainterExtension from "@pi-ohm/painter";
import registerModesExtension from "@pi-ohm/modes";
import registerMemoriesExtension from "@pi-ohm/memories";
import { OHM_FEATURE_PACKAGES, OHM_RECOMMENDED_NEXT } from "./manifest";

async function loadBundleConfig(cwd: string) {
  const loaded = await loadConfig({
    cwd,
    modules: [extensionConfigModule, featuresConfigModule, painterConfigModule],
  });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const core = pickConfig({
    loaded: loaded.value,
    module: extensionConfigModule,
    is: isExtensionRuntimeConfig,
  });
  if (Result.isError(core)) return Result.err(core.error);

  const features = pickConfig({
    loaded: loaded.value,
    module: featuresConfigModule,
    is: isFeatureFlags,
  });
  if (Result.isError(features)) return Result.err(features.error);

  return Result.ok({ loaded: loaded.value, core: core.value, features: features.value });
}

export default function registerPiOhmExtension(pi: ExtensionAPI): void {
  registerHandoffExtension(pi);
  registerSubagentsExtension(pi);
  registerSessionSearchExtension(pi);
  registerPainterExtension(pi);
  registerModesExtension(pi);
  registerMemoriesExtension(pi);

  pi.registerCommand("ohm-features", {
    description: "Show installed pi-ohm feature packages and feature flags",
    handler: async (_args, ctx) => {
      const config = await loadBundleConfig(ctx.cwd);
      if (Result.isError(config)) {
        console.log(config.error.message);
        return;
      }

      const lines = [
        `handoff: ${config.value.features.handoff ? "on" : "off"}`,
        `subagents: ${config.value.features.subagents ? "on" : "off"}`,
        `sessionThreadSearch: ${config.value.features.sessionThreadSearch ? "on" : "off"}`,
        `handoffVisualizer: ${config.value.features.handoffVisualizer ? "on" : "off"}`,
        `painterImagegen: ${config.value.features.painterImagegen ? "on" : "off"}`,
        `defaultMode: ${config.value.core.defaultMode}`,
      ];

      const text = [
        "Pi OHM bundle",
        "",
        "Packages:",
        ...OHM_FEATURE_PACKAGES.map((pkg) => `- ${pkg}`),
        "",
        "Feature flags:",
        ...lines.map((line) => `- ${line}`),
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm features", text);
    },
  });

  pi.registerCommand("ohm-config", {
    description: "Inspect effective Pi OHM runtime config",
    handler: async (_args, ctx) => {
      const config = await loadBundleConfig(ctx.cwd);
      if (Result.isError(config)) {
        console.log(config.error.message);
        return;
      }

      const text = [
        "Pi OHM effective config",
        "",
        JSON.stringify(config.value.loaded.config, null, 2),
        "",
        `configDir: ${config.value.loaded.paths.configDir}`,
        `projectConfigFile: ${config.value.loaded.paths.projectConfigFile}`,
        `globalConfigFile: ${config.value.loaded.paths.globalConfigFile}`,
        `loadedFrom: ${config.value.loaded.loadedFrom.length > 0 ? config.value.loaded.loadedFrom.join(", ") : "defaults"}`,
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm config", text);
    },
  });

  pi.registerCommand("ohm-missing", {
    description: "Show likely next package candidates",
    handler: async (_args, ctx) => {
      const text = [
        "Likely next packages",
        "",
        ...OHM_RECOMMENDED_NEXT.map((item) => `- ${item.name}: ${item.reason}`),
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm recommended next", text);
    },
  });
}
