import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadOhmRuntimeConfig, registerOhmSettings } from "@pi-phm/config";

export default function registerSubagentsExtension(pi: ExtensionAPI): void {
  registerOhmSettings(pi);

  pi.on("session_start", async (_event, ctx) => {
    const { config } = await loadOhmRuntimeConfig(ctx.cwd);
    if (!ctx.hasUI) return;

    const enabled = config.features.subagents ? "on" : "off";
    ctx.ui.setStatus("ohm-subagents", `subagents:${enabled} · backend:${config.subagentBackend}`);
  });

  pi.registerCommand("ohm-subagents", {
    description: "Show subagent backend and feature state",
    handler: async (_args, ctx) => {
      const { config, loadedFrom } = await loadOhmRuntimeConfig(ctx.cwd);
      const text = [
        "Pi PHM: subagents",
        "",
        `enabled: ${config.features.subagents ? "yes" : "no"}`,
        `backend: ${config.subagentBackend}`,
        "",
        `loadedFrom: ${loadedFrom.length > 0 ? loadedFrom.join(", ") : "defaults + extension settings"}`,
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-phm subagents", text);
    },
  });
}
