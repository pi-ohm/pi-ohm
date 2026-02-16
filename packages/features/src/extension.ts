import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  loadOhmRuntimeConfig,
  registerOhmSettings,
  type OhmRuntimeConfig,
} from "../../config/src/index";
import { OHM_FOCUS_FEATURES, RECOMMENDED_NEXT_FEATURES } from "./manifest";

function getEnabledFocusFeatureCount(config: OhmRuntimeConfig): number {
  const featureFlags = config.features;
  return [
    featureFlags.handoff,
    featureFlags.subagents,
    featureFlags.sessionThreadSearch,
    featureFlags.handoffVisualizer,
    featureFlags.painterImagegen,
  ].filter(Boolean).length;
}

function getFeatureFlagStatus(config: OhmRuntimeConfig, featureId: string): boolean {
  switch (featureId) {
    case "handoff":
      return config.features.handoff;
    case "subagents":
      return config.features.subagents;
    case "session-thread-search":
      return config.features.sessionThreadSearch;
    case "handoff-visualizer":
      return config.features.handoffVisualizer;
    case "painter-imagegen":
      return config.features.painterImagegen;
    default:
      return false;
  }
}

async function renderStatus(_pi: ExtensionAPI, ctx: ExtensionContext) {
  const { config } = await loadOhmRuntimeConfig(ctx.cwd);
  const enabled = getEnabledFocusFeatureCount(config);

  if (!ctx.hasUI) return;
  ctx.ui.setStatus(
    "ohm",
    `mode:${config.defaultMode} · ${enabled}/${OHM_FOCUS_FEATURES.length} focus features`,
  );

  if (!config.features.handoffVisualizer) {
    ctx.ui.setWidget("ohm-handoff-map", undefined, { placement: "belowEditor" });
    return;
  }

  const lines = [
    "ohm handoff visualizer (scaffold)",
    `session: ${ctx.sessionManager.getSessionFile() ?? "ephemeral"}`,
    "next: wire this into /resume tree + handoff links",
  ];
  ctx.ui.setWidget("ohm-handoff-map", lines, { placement: "belowEditor" });
}

export default function registerOhmFeaturesExtension(pi: ExtensionAPI) {
  registerOhmSettings(pi);

  pi.on("session_start", async (_event, ctx) => {
    await renderStatus(pi, ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    await renderStatus(pi, ctx);
  });

  pi.registerCommand("ohm-features", {
    description: "Show Pi Ohm focus feature modules and current enabled state",
    handler: async (_args, ctx) => {
      const { config } = await loadOhmRuntimeConfig(ctx.cwd);

      const lines = OHM_FOCUS_FEATURES.map((feature) => {
        const enabled = getFeatureFlagStatus(config, feature.id) ? "on" : "off";
        return `- [${enabled}] ${feature.title} -> ${feature.modulePath}`;
      });

      const painterProviders = [
        `googleNanoBanana=${config.painter.googleNanoBanana.enabled ? "on" : "off"} (${config.painter.googleNanoBanana.model})`,
        `openai=${config.painter.openai.enabled ? "on" : "off"} (${config.painter.openai.model})`,
        `azureOpenAI=${config.painter.azureOpenai.enabled ? "on" : "off"}${config.painter.azureOpenai.deployment ? ` (${config.painter.azureOpenai.deployment})` : ""}`,
      ];

      const text = [
        "Pi Ohm focus features",
        "",
        ...lines,
        "",
        `subagent backend: ${config.subagentBackend}`,
        `painter providers: ${painterProviders.join(", ")}`,
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm focus features", text);
    },
  });

  pi.registerCommand("ohm-config", {
    description: "Inspect effective Pi Ohm config and config file paths",
    handler: async (_args, ctx) => {
      const loaded = await loadOhmRuntimeConfig(ctx.cwd);

      const text = [
        "Pi Ohm effective config",
        "",
        JSON.stringify(loaded.config, null, 2),
        "",
        "Paths:",
        `- configDir: ${loaded.paths.configDir}`,
        `- projectConfigFile: ${loaded.paths.projectConfigFile}`,
        `- globalConfigFile: ${loaded.paths.globalConfigFile}`,
        `- providersConfigFile: ${loaded.paths.providersConfigFile}`,
        "",
        `Loaded from: ${loaded.loadedFrom.length > 0 ? loaded.loadedFrom.join(", ") : "defaults + extension settings"}`,
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm config", text);
    },
  });

  pi.registerCommand("ohm-missing", {
    description: "Show recommended next features beyond the initial focus set",
    handler: async (_args, ctx) => {
      const lines = RECOMMENDED_NEXT_FEATURES.map((item) => `- ${item.name}: ${item.reason}`);
      const text = ["Likely missing next layers", "", ...lines].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm recommended next", text);
    },
  });
}
