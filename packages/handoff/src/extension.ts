import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadOhmRuntimeConfig, registerOhmSettings } from "@pi-ohm/config";

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
  const { config } = await loadOhmRuntimeConfig(ctx.cwd);
  const enabled = config.features.handoff ? "on" : "off";
  const viz = config.features.handoffVisualizer ? "on" : "off";

  if (ctx.hasUI) {
    ctx.ui.setStatus("ohm-handoff", `handoff:${enabled} · visualizer:${viz}`);
  }

  renderHandoffMapWidget(ctx, config.features.handoff && config.features.handoffVisualizer);
}

export default function registerHandoffExtension(pi: ExtensionAPI): void {
  registerOhmSettings(pi);

  pi.on("session_start", async (_event, ctx) => {
    await refreshStatus(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    await refreshStatus(ctx);
  });

  pi.registerCommand("ohm-handoff", {
    description: "Show handoff + visualizer config and status",
    handler: async (_args, ctx) => {
      const loaded = await loadOhmRuntimeConfig(ctx.cwd);
      const text = [
        "Pi PHM: handoff",
        "",
        `enabled: ${loaded.config.features.handoff ? "yes" : "no"}`,
        `visualizer: ${loaded.config.features.handoffVisualizer ? "yes" : "no"}`,
        `subagent backend: ${loaded.config.subagentBackend}`,
        "",
        `configDir: ${loaded.paths.configDir}`,
        `loadedFrom: ${loaded.loadedFrom.length > 0 ? loaded.loadedFrom.join(", ") : "defaults + extension settings"}`,
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm handoff", text);
    },
  });
}
