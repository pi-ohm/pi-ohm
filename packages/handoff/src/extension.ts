import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import { loadConfig, pickConfig, registerGlobalConfigModule } from "@pi-ohm/core/config";
import registerOhmConfigExtension from "@pi-ohm/tui/ohm-config";
import { handoffConfigModule, isHandoffConfig } from "./config";

async function loadHandoffConfig(cwd: string) {
  const loaded = await loadConfig({ cwd, modules: [handoffConfigModule] });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const config = pickConfig({
    loaded: loaded.value,
    module: handoffConfigModule,
    is: isHandoffConfig,
  });
  if (Result.isError(config)) return Result.err(config.error);

  return Result.ok({ loaded: loaded.value, config: config.value });
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

  const enabled = config.value.config.enabled ? "on" : "off";
  const viz = config.value.config.visualizer ? "on" : "off";

  if (ctx.hasUI) {
    ctx.ui.setStatus("ohm-handoff", `handoff:${enabled} · visualizer:${viz}`);
  }

  renderHandoffMapWidget(ctx, config.value.config.enabled && config.value.config.visualizer);
}

export default function registerHandoffExtension(pi: ExtensionAPI): void {
  registerGlobalConfigModule(handoffConfigModule);
  registerOhmConfigExtension(pi);

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
        `enabled: ${config.value.config.enabled ? "yes" : "no"}`,
        `visualizer: ${config.value.config.visualizer ? "yes" : "no"}`,
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
