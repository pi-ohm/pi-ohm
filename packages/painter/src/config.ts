import { Result } from "better-result";
import { type StaticDecode } from "typebox";
import { registerConfig } from "@pi-ohm/core/config";
import { PainterConfigSchema } from "./schema";

export { PainterConfigSchema } from "./schema";

export interface PainterConfig {
  enabled: boolean;
  googleNanoBanana: {
    enabled: boolean;
    model: string;
  };
  openai: {
    enabled: boolean;
    model: string;
  };
  azureOpenai: {
    enabled: boolean;
    deployment: string;
    endpoint: string;
    apiVersion: string;
  };
}

export const DEFAULT_PAINTER_CONFIG: PainterConfig = {
  enabled: true,
  googleNanoBanana: {
    enabled: true,
    model: "gemini-2.5-flash-image-preview",
  },
  openai: {
    enabled: true,
    model: "gpt-image-1",
  },
  azureOpenai: {
    enabled: false,
    deployment: "",
    endpoint: "",
    apiVersion: "2025-04-01-preview",
  },
};

type PainterConfigPatch = StaticDecode<typeof PainterConfigSchema>;

function mergeProvider(
  base: PainterConfig["openai"],
  patch: PainterConfigPatch["openai"],
): PainterConfig["openai"] {
  return {
    enabled: patch?.enabled ?? base.enabled,
    model: patch?.model ?? base.model,
  };
}

export const painterConfigModule = registerConfig({
  namespace: "painter",
  schema: PainterConfigSchema,
  defaults: DEFAULT_PAINTER_CONFIG,
  merge(base: PainterConfig, patch: PainterConfigPatch) {
    return Result.ok({
      enabled: patch.enabled ?? base.enabled,
      googleNanoBanana: mergeProvider(base.googleNanoBanana, patch.googleNanoBanana),
      openai: mergeProvider(base.openai, patch.openai),
      azureOpenai: {
        enabled: patch.azureOpenai?.enabled ?? base.azureOpenai.enabled,
        deployment: patch.azureOpenai?.deployment ?? base.azureOpenai.deployment,
        endpoint: patch.azureOpenai?.endpoint ?? base.azureOpenai.endpoint,
        apiVersion: patch.azureOpenai?.apiVersion ?? base.azureOpenai.apiVersion,
      },
    });
  },
});

function isProviderConfig(value: unknown): value is PainterConfig["openai"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return (
    typeof Reflect.get(value, "enabled") === "boolean" &&
    typeof Reflect.get(value, "model") === "string"
  );
}

export function isPainterConfig(value: unknown): value is PainterConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const azure = Reflect.get(value, "azureOpenai");
  if (typeof azure !== "object" || azure === null || Array.isArray(azure)) return false;

  return (
    typeof Reflect.get(value, "enabled") === "boolean" &&
    isProviderConfig(Reflect.get(value, "googleNanoBanana")) &&
    isProviderConfig(Reflect.get(value, "openai")) &&
    typeof Reflect.get(azure, "enabled") === "boolean" &&
    typeof Reflect.get(azure, "deployment") === "string" &&
    typeof Reflect.get(azure, "endpoint") === "string" &&
    typeof Reflect.get(azure, "apiVersion") === "string"
  );
}
