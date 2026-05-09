import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import {
  featuresConfigModule,
  isFeatureFlags,
  isPainterProviders,
  loadConfig,
  painterConfigModule,
  pickConfig,
} from "@pi-ohm/core/config";

async function loadPainterConfig(cwd: string) {
  const loaded = await loadConfig({ cwd, modules: [featuresConfigModule, painterConfigModule] });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const features = pickConfig({
    loaded: loaded.value,
    module: featuresConfigModule,
    is: isFeatureFlags,
  });
  if (Result.isError(features)) return Result.err(features.error);

  const painter = pickConfig({
    loaded: loaded.value,
    module: painterConfigModule,
    is: isPainterProviders,
  });
  if (Result.isError(painter)) return Result.err(painter.error);

  return Result.ok({ loaded: loaded.value, features: features.value, painter: painter.value });
}

export default function registerPainterExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const config = await loadPainterConfig(ctx.cwd);
    if (Result.isError(config)) return;
    if (!ctx.hasUI) return;

    if (!config.value.features.painterImagegen) {
      ctx.ui.setStatus("ohm-painter", "painter:off");
      return;
    }

    const providers = [
      config.value.painter.googleNanoBanana.enabled ? "google" : null,
      config.value.painter.openai.enabled ? "openai" : null,
      config.value.painter.azureOpenai.enabled ? "azure" : null,
    ].filter(Boolean);

    ctx.ui.setStatus(
      "ohm-painter",
      `painter:on · providers:${providers.length > 0 ? providers.join("+") : "none"}`,
    );
  });

  pi.registerCommand("ohm-painter", {
    description: "Show painter provider configuration",
    handler: async (_args, ctx) => {
      const config = await loadPainterConfig(ctx.cwd);
      if (Result.isError(config)) {
        console.log(config.error.message);
        return;
      }

      const text = [
        "Pi OHM: painter/imagegen",
        "",
        `featureEnabled: ${config.value.features.painterImagegen ? "yes" : "no"}`,
        `googleNanoBanana: ${config.value.painter.googleNanoBanana.enabled ? "on" : "off"} (${config.value.painter.googleNanoBanana.model})`,
        `openai: ${config.value.painter.openai.enabled ? "on" : "off"} (${config.value.painter.openai.model})`,
        `azureOpenAI: ${config.value.painter.azureOpenai.enabled ? "on" : "off"}`,
        `azureDeployment: ${config.value.painter.azureOpenai.deployment || "<unset>"}`,
        `azureEndpoint: ${config.value.painter.azureOpenai.endpoint || "<unset>"}`,
        `azureApiVersion: ${config.value.painter.azureOpenai.apiVersion}`,
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm painter", text);
    },
  });
}
