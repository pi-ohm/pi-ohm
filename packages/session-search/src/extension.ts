import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadOhmRuntimeConfig, registerOhmSettings } from "@pi-ohm/config";

export default function registerSessionSearchExtension(pi: ExtensionAPI): void {
  registerOhmSettings(pi);

  pi.on("session_start", async (_event, ctx) => {
    const { config } = await loadOhmRuntimeConfig(ctx.cwd);
    if (!ctx.hasUI) return;

    const enabled = config.features.sessionThreadSearch ? "on" : "off";
    ctx.ui.setStatus("ohm-session-search", `session-search:${enabled}`);
  });

  pi.registerCommand("ohm-session-search", {
    description: "Show session/thread search feature state",
    handler: async (_args, ctx) => {
      const { config } = await loadOhmRuntimeConfig(ctx.cwd);
      const text = [
        "Pi PHM: session/thread search",
        "",
        `enabled: ${config.features.sessionThreadSearch ? "yes" : "no"}`,
        "",
        "Scaffold note: connect this package to session_query + thread index tools.",
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm session search", text);
    },
  });
}
