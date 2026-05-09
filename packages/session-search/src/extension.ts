import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import { loadConfig, pickConfig } from "@pi-ohm/core/config";
import { isSessionSearchConfig, sessionSearchConfigModule } from "./config";

async function loadSessionSearchConfig(cwd: string) {
  const loaded = await loadConfig({ cwd, modules: [sessionSearchConfigModule] });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const config = pickConfig({
    loaded: loaded.value,
    module: sessionSearchConfigModule,
    is: isSessionSearchConfig,
  });
  if (Result.isError(config)) return Result.err(config.error);

  return Result.ok({ loaded: loaded.value, config: config.value });
}

export default function registerSessionSearchExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const config = await loadSessionSearchConfig(ctx.cwd);
    if (Result.isError(config)) return;
    if (!ctx.hasUI) return;

    const enabled = config.value.config.enabled ? "on" : "off";
    ctx.ui.setStatus("ohm-session-search", `session-search:${enabled}`);
  });

  pi.registerCommand("ohm-session-search", {
    description: "Show session/thread search feature state",
    handler: async (_args, ctx) => {
      const config = await loadSessionSearchConfig(ctx.cwd);
      if (Result.isError(config)) {
        console.log(config.error.message);
        return;
      }

      const text = [
        "Pi OHM: session/thread search",
        "",
        `enabled: ${config.value.config.enabled ? "yes" : "no"}`,
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
