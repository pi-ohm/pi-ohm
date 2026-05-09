import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import {
  extensionConfigModule,
  featuresConfigModule,
  isExtensionRuntimeConfig,
  isFeatureFlags,
  loadConfig,
  pickConfig,
} from "@pi-ohm/core/config";

async function loadHandoffConfig(cwd: string) {
  const loaded = await loadConfig({ cwd, modules: [extensionConfigModule, featuresConfigModule] });
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

function renderHandoffMapWidget(ctx: ExtensionContext, visible: boolean): void {
  if (!ctx.hasUI) return;

  if (!visible) {
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

async function refreshStatus(ctx: ExtensionContext): Promise<void> {
  const config = await loadHandoffConfig(ctx.cwd);
  if (Result.isError(config)) return;

  const enabled = config.value.features.handoff ? "on" : "off";
  const viz = config.value.features.handoffVisualizer ? "on" : "off";

  if (ctx.hasUI) {
    ctx.ui.setStatus("ohm-handoff", `handoff:${enabled} · visualizer:${viz}`);
  }

  renderHandoffMapWidget(
    ctx,
    config.value.features.handoff && config.value.features.handoffVisualizer,
  );
}

export default function registerHandoffExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    await refreshStatus(ctx);
  });

  pi.registerCommand("ohm-handoff", {
    description: "Show handoff + visualizer config and status",
    handler: async (_args, ctx) => {
      const config = await loadHandoffConfig(ctx.cwd);
      if (Result.isError(config)) {
        console.log(config.error.message);
        return;
      }

      const text = [
        "Pi OHM: handoff",
        "",
        `enabled: ${config.value.features.handoff ? "yes" : "no"}`,
        `visualizer: ${config.value.features.handoffVisualizer ? "yes" : "no"}`,
        `subagent backend: ${config.value.core.subagentBackend}`,
        "",
        `configDir: ${config.value.loaded.paths.configDir}`,
        `loadedFrom: ${config.value.loaded.loadedFrom.length > 0 ? config.value.loaded.loadedFrom.join(", ") : "defaults"}`,
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm handoff", text);
    },
  });
}
