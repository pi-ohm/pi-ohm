export interface OhmPainterProviders {
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

const BOOLEAN_TRUE_VALUES = ["1", "true", "yes", "on", "enabled"];
const BOOLEAN_FALSE_VALUES = ["0", "false", "no", "off", "disabled"];

export const DEFAULT_OHM_PAINTER_PROVIDERS: OhmPainterProviders = {
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

function isJsonMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  if (BOOLEAN_TRUE_VALUES.includes(normalized)) return true;
  if (BOOLEAN_FALSE_VALUES.includes(normalized)) return false;
  return fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  return fallback;
}

export function mergeOhmPainterProviders(
  base: OhmPainterProviders,
  patch: unknown,
): OhmPainterProviders {
  const painterPatch = isJsonMap(patch) ? patch : {};
  const googlePatch = isJsonMap(painterPatch.googleNanoBanana) ? painterPatch.googleNanoBanana : {};
  const openaiPatch = isJsonMap(painterPatch.openai) ? painterPatch.openai : {};
  const azurePatch = isJsonMap(painterPatch.azureOpenai) ? painterPatch.azureOpenai : {};

  return {
    googleNanoBanana: {
      enabled: normalizeBoolean(googlePatch.enabled, base.googleNanoBanana.enabled),
      model: normalizeString(googlePatch.model, base.googleNanoBanana.model),
    },
    openai: {
      enabled: normalizeBoolean(openaiPatch.enabled, base.openai.enabled),
      model: normalizeString(openaiPatch.model, base.openai.model),
    },
    azureOpenai: {
      enabled: normalizeBoolean(azurePatch.enabled, base.azureOpenai.enabled),
      deployment: normalizeString(azurePatch.deployment, base.azureOpenai.deployment),
      endpoint: normalizeString(azurePatch.endpoint, base.azureOpenai.endpoint),
      apiVersion: normalizeString(azurePatch.apiVersion, base.azureOpenai.apiVersion),
    },
  };
}
