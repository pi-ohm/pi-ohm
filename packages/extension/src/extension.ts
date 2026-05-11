import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import { loadConfig, pickConfig } from "@pi-ohm/core/config";
import registerHandoffExtension from "@pi-ohm/handoff";
import { handoffConfigModule, isHandoffConfig } from "@pi-ohm/handoff/config";
import registerSubagentsExtension from "@pi-ohm/subagents";
import { isSubagentRuntimeConfig, subagentsConfigModule } from "@pi-ohm/subagents/config";
import registerSessionSearchExtension from "@pi-ohm/session-search";
import { isSessionSearchConfig, sessionSearchConfigModule } from "@pi-ohm/session-search/config";
import registerPainterExtension from "@pi-ohm/painter";
import { isPainterConfig, painterConfigModule } from "@pi-ohm/painter/config";
import registerModesExtension from "@pi-ohm/modes";
import { isModesConfig, modesConfigModule } from "@pi-ohm/modes/config";
import registerMemoriesExtension from "@pi-ohm/memories";
import { OHM_FEATURE_PACKAGES, OHM_RECOMMENDED_NEXT } from "./manifest";

async function loadBundleConfig(cwd: string) {
  const modules = [
    handoffConfigModule,
    modesConfigModule,
    painterConfigModule,
    sessionSearchConfigModule,
    subagentsConfigModule,
  ];
  const loaded = await loadConfig({
    cwd,
    modules,
  });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const handoff = pickConfig({
    loaded: loaded.value,
    module: handoffConfigModule,
    is: isHandoffConfig,
  });
  if (Result.isError(handoff)) return Result.err(handoff.error);

  const modes = pickConfig({ loaded: loaded.value, module: modesConfigModule, is: isModesConfig });
  if (Result.isError(modes)) return Result.err(modes.error);

  const painter = pickConfig({
    loaded: loaded.value,
    module: painterConfigModule,
    is: isPainterConfig,
  });
  if (Result.isError(painter)) return Result.err(painter.error);

  const search = pickConfig({
    loaded: loaded.value,
    module: sessionSearchConfigModule,
    is: isSessionSearchConfig,
  });
  if (Result.isError(search)) return Result.err(search.error);

  const subagents = pickConfig({
    loaded: loaded.value,
    module: subagentsConfigModule,
    is: isSubagentRuntimeConfig,
  });
  if (Result.isError(subagents)) return Result.err(subagents.error);

  return Result.ok({
    loaded: loaded.value,
    handoff: handoff.value,
    modes: modes.value,
    painter: painter.value,
    search: search.value,
    subagents: subagents.value,
  });
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
        `handoff: ${config.value.handoff.enabled ? "on" : "off"}`,
        `subagents: on`,
        `sessionSearch: ${config.value.search.enabled ? "on" : "off"}`,
        `handoffVisualizer: ${config.value.handoff.visualizer ? "on" : "off"}`,
        `painter: ${config.value.painter.enabled ? "on" : "off"}`,
        `defaultMode: ${config.value.modes.defaultMode}`,
      ];

      const text = [
        "Pi OHM bundle",
        "",
        "Packages:",
        ...OHM_FEATURE_PACKAGES.map((pkg) => `- ${pkg}`),
        "",
        "Extension config:",
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
