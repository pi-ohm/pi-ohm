import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadOhmRuntimeConfig, registerOhmSettings } from "@pi-phm/config";
import registerHandoffExtension from "@pi-phm/handoff";
import registerSubagentsExtension from "@pi-phm/subagents";
import registerSessionSearchExtension from "@pi-phm/session-search";
import registerPainterExtension from "@pi-phm/painter";
import registerModesExtension from "@pi-ohm/modes";
import { PHM_FEATURE_PACKAGES, PHM_RECOMMENDED_NEXT } from "./manifest";

export default function registerPiPhmExtension(pi: ExtensionAPI): void {
  registerOhmSettings(pi);

  registerHandoffExtension(pi);
  registerSubagentsExtension(pi);
  registerSessionSearchExtension(pi);
  registerPainterExtension(pi);
  registerModesExtension(pi);

  pi.registerCommand("ohm-features", {
    description: "Show installed pi-phm feature packages and feature flags",
    handler: async (_args, ctx) => {
      const { config } = await loadOhmRuntimeConfig(ctx.cwd);
      const lines = [
        `handoff: ${config.features.handoff ? "on" : "off"}`,
        `subagents: ${config.features.subagents ? "on" : "off"}`,
        `sessionThreadSearch: ${config.features.sessionThreadSearch ? "on" : "off"}`,
        `handoffVisualizer: ${config.features.handoffVisualizer ? "on" : "off"}`,
        `painterImagegen: ${config.features.painterImagegen ? "on" : "off"}`,
        `defaultMode: ${config.defaultMode}`,
      ];

      const text = [
        "Pi PHM bundle",
        "",
        "Packages:",
        ...PHM_FEATURE_PACKAGES.map((pkg) => `- ${pkg}`),
        "",
        "Feature flags:",
        ...lines.map((line) => `- ${line}`),
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-phm features", text);
    },
  });

  pi.registerCommand("ohm-config", {
    description: "Inspect effective Pi PHM runtime config",
    handler: async (_args, ctx) => {
      const loaded = await loadOhmRuntimeConfig(ctx.cwd);
      const text = [
        "Pi PHM effective config",
        "",
        JSON.stringify(loaded.config, null, 2),
        "",
        `configDir: ${loaded.paths.configDir}`,
        `projectConfigFile: ${loaded.paths.projectConfigFile}`,
        `globalConfigFile: ${loaded.paths.globalConfigFile}`,
        `providersConfigFile: ${loaded.paths.providersConfigFile}`,
        `loadedFrom: ${loaded.loadedFrom.length > 0 ? loaded.loadedFrom.join(", ") : "defaults + extension settings"}`,
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-phm config", text);
    },
  });

  pi.registerCommand("ohm-missing", {
    description: "Show likely next package candidates",
    handler: async (_args, ctx) => {
      const text = [
        "Likely next packages",
        "",
        ...PHM_RECOMMENDED_NEXT.map((item) => `- ${item.name}: ${item.reason}`),
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-phm recommended next", text);
    },
  });
}
