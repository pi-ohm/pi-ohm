import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadOhmRuntimeConfig, registerOhmSettings } from "@pi-ohm/config";

export default function registerPainterExtension(pi: ExtensionAPI): void {
  registerOhmSettings(pi);

  pi.on("session_start", async (_event, ctx) => {
    const { config } = await loadOhmRuntimeConfig(ctx.cwd);
    if (!ctx.hasUI) return;

    if (!config.features.painterImagegen) {
      ctx.ui.setStatus("ohm-painter", "painter:off");
      return;
    }

    const providers = [
      config.painter.googleNanoBanana.enabled ? "google" : null,
      config.painter.openai.enabled ? "openai" : null,
      config.painter.azureOpenai.enabled ? "azure" : null,
    ].filter(Boolean);

    ctx.ui.setStatus(
      "ohm-painter",
      `painter:on · providers:${providers.length > 0 ? providers.join("+") : "none"}`,
    );
  });

  pi.registerCommand("ohm-painter", {
    description: "Show painter provider configuration",
    handler: async (_args, ctx) => {
      const { config } = await loadOhmRuntimeConfig(ctx.cwd);
      const text = [
        "Pi OHM: painter/imagegen",
        "",
        `featureEnabled: ${config.features.painterImagegen ? "yes" : "no"}`,
        `googleNanoBanana: ${config.painter.googleNanoBanana.enabled ? "on" : "off"} (${config.painter.googleNanoBanana.model})`,
        `openai: ${config.painter.openai.enabled ? "on" : "off"} (${config.painter.openai.model})`,
        `azureOpenAI: ${config.painter.azureOpenai.enabled ? "on" : "off"}`,
        `azureDeployment: ${config.painter.azureOpenai.deployment || "<unset>"}`,
        `azureEndpoint: ${config.painter.azureOpenai.endpoint || "<unset>"}`,
        `azureApiVersion: ${config.painter.azureOpenai.apiVersion}`,
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm painter", text);
    },
  });
}
