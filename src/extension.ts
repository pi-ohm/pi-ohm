import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { FEATURE_CATALOG } from "./feature-catalog";
import { loadOhmConfig } from "./config/load-config";

function summarizeFeatureFlags(enabledFeatures: string[]): string {
  const p0Enabled = FEATURE_CATALOG.filter(
    (feature) => feature.phase === "P0" && enabledFeatures.includes(feature.slug),
  ).length;
  const p0Total = FEATURE_CATALOG.filter((feature) => feature.phase === "P0").length;
  return `${p0Enabled}/${p0Total} P0 features enabled`;
}

export default function registerOhmExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const { config } = await loadOhmConfig(ctx.cwd);
    if (!ctx.hasUI) return;
    ctx.ui.setStatus("ohm", `mode:${config.defaultMode} · ${summarizeFeatureFlags(config.enabledFeatures)}`);
  });

  pi.registerCommand("ohm-features", {
    description: "Show scaffolded Amp-like feature modules",
    handler: async (_args, ctx) => {
      const { config, loadedFrom } = await loadOhmConfig(ctx.cwd);
      const lines = FEATURE_CATALOG.map((feature) => {
        const enabled = config.enabledFeatures.includes(feature.slug) ? "on" : "off";
        return `${feature.phase} [${enabled}] ${feature.slug} -> ${feature.path}`;
      });

      if (!ctx.hasUI) {
        console.log(lines.join("\n"));
        return;
      }

      const header = loadedFrom ? `Config: ${loadedFrom}` : "Config: defaults";
      const text = [header, "", ...lines].join("\n");
      await ctx.ui.editor("pi-ohm feature catalog", text);
    },
  });
}
