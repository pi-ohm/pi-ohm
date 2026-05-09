import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import {
  featuresConfigModule,
  isOhmFeatureFlags,
  loadOhmConfig,
  pickOhmConfig,
} from "@pi-ohm/core/config";

async function loadSessionSearchConfig(cwd: string) {
  const loaded = await loadOhmConfig({ cwd, modules: [featuresConfigModule] });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const features = pickOhmConfig({
    loaded: loaded.value,
    module: featuresConfigModule,
    is: isOhmFeatureFlags,
  });
  if (Result.isError(features)) return Result.err(features.error);

  return Result.ok({ loaded: loaded.value, features: features.value });
}

export default function registerSessionSearchExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const config = await loadSessionSearchConfig(ctx.cwd);
    if (Result.isError(config)) return;
    if (!ctx.hasUI) return;

    const enabled = config.value.features.sessionThreadSearch ? "on" : "off";
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
        `enabled: ${config.value.features.sessionThreadSearch ? "yes" : "no"}`,
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
