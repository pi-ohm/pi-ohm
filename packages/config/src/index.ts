import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  getSetting,
  setSetting,
  type SettingDefinition,
} from "@juanibiapina/pi-extension-settings";
import { DEFAULT_OHM_FEATURE_FLAGS, mergeOhmFeatureFlags, type OhmFeatureFlags } from "./features";
import { DEFAULT_OHM_MODE, normalizeOhmMode, type OhmMode } from "./modes";
import {
  DEFAULT_OHM_PAINTER_PROVIDERS,
  mergeOhmPainterProviders,
  type OhmPainterProviders,
} from "./painter";
import {
  DEFAULT_OHM_SUBAGENT_RUNTIME_CONFIG,
  mergeSubagentRuntimeConfig,
  type OhmSubagentRuntimeConfig,
} from "./subagents";

export const OHM_EXTENSION_NAME = "pi-ohm";
export type OhmSubagentBackend = "none" | "interactive-shell" | "interactive-sdk" | "custom-plugin";

export interface OhmRuntimeConfig {
  defaultMode: OhmMode;
  subagentBackend: OhmSubagentBackend;
  features: OhmFeatureFlags;
  painter: OhmPainterProviders;
  subagents?: OhmSubagentRuntimeConfig;
}

export interface OhmConfigPaths {
  configDir: string;
  projectConfigFile: string;
  globalConfigFile: string;
  providersConfigFile: string;
}

export interface LoadedOhmRuntimeConfig {
  config: OhmRuntimeConfig;
  paths: OhmConfigPaths;
  loadedFrom: string[];
}

const DEFAULT_OHM_CONFIG: OhmRuntimeConfig = {
  defaultMode: DEFAULT_OHM_MODE,
  subagentBackend: "interactive-sdk",
  features: DEFAULT_OHM_FEATURE_FLAGS,
  painter: DEFAULT_OHM_PAINTER_PROVIDERS,
  subagents: DEFAULT_OHM_SUBAGENT_RUNTIME_CONFIG,
};

type JsonMap = Record<string, unknown>;

function isJsonMap(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function resolveOhmConfigDir(): string {
  const envDir =
    process.env.PI_CONFIG_DIR ?? process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR;

  if (envDir && envDir.trim().length > 0) {
    return expandHome(envDir.trim());
  }

  return path.join(os.homedir(), ".pi", "agent");
}

export function resolveOhmConfigPaths(cwd: string): OhmConfigPaths {
  const configDir = resolveOhmConfigDir();
  return {
    configDir,
    projectConfigFile: path.join(cwd, ".pi", "ohm.json"),
    globalConfigFile: path.join(configDir, "ohm.json"),
    providersConfigFile: path.join(configDir, "ohm.providers.json"),
  };
}

async function readJsonFile(filePath: string): Promise<JsonMap | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isJsonMap(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

function normalizeSubagentBackend(
  value: unknown,
  fallback: OhmSubagentBackend,
): OhmSubagentBackend {
  if (
    value === "none" ||
    value === "interactive-shell" ||
    value === "interactive-sdk" ||
    value === "custom-plugin"
  ) {
    return value;
  }
  return fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  return fallback;
}

function mergeConfig(base: OhmRuntimeConfig, patch: JsonMap): OhmRuntimeConfig {
  const next: OhmRuntimeConfig = structuredClone(base);

  next.defaultMode = normalizeOhmMode(patch.defaultMode, next.defaultMode);
  next.subagentBackend = normalizeSubagentBackend(patch.subagentBackend, next.subagentBackend);

  next.features = mergeOhmFeatureFlags(next.features, patch.features);
  next.painter = mergeOhmPainterProviders(next.painter, patch.painter);

  next.subagents = mergeSubagentRuntimeConfig({
    current: next.subagents,
    patch: patch.subagents,
  });

  return next;
}

function applyExtensionSettings(config: OhmRuntimeConfig): OhmRuntimeConfig {
  const next = structuredClone(config);

  next.defaultMode = normalizeOhmMode(
    getSetting(OHM_EXTENSION_NAME, "default-mode", next.defaultMode),
    next.defaultMode,
  );

  next.subagentBackend = normalizeSubagentBackend(
    getSetting(OHM_EXTENSION_NAME, "subagent-backend", next.subagentBackend),
    next.subagentBackend,
  );

  next.features.handoff = normalizeBoolean(
    getSetting(OHM_EXTENSION_NAME, "feature-handoff", next.features.handoff ? "on" : "off"),
    next.features.handoff,
  );

  next.features.subagents = normalizeBoolean(
    getSetting(OHM_EXTENSION_NAME, "feature-subagents", next.features.subagents ? "on" : "off"),
    next.features.subagents,
  );

  next.features.sessionThreadSearch = normalizeBoolean(
    getSetting(
      OHM_EXTENSION_NAME,
      "feature-session-thread-search",
      next.features.sessionThreadSearch ? "on" : "off",
    ),
    next.features.sessionThreadSearch,
  );

  next.features.handoffVisualizer = normalizeBoolean(
    getSetting(
      OHM_EXTENSION_NAME,
      "feature-handoff-visualizer",
      next.features.handoffVisualizer ? "on" : "off",
    ),
    next.features.handoffVisualizer,
  );

  next.features.painterImagegen = normalizeBoolean(
    getSetting(
      OHM_EXTENSION_NAME,
      "feature-painter-imagegen",
      next.features.painterImagegen ? "on" : "off",
    ),
    next.features.painterImagegen,
  );

  next.painter.googleNanoBanana.enabled = normalizeBoolean(
    getSetting(
      OHM_EXTENSION_NAME,
      "painter-google-enabled",
      next.painter.googleNanoBanana.enabled ? "on" : "off",
    ),
    next.painter.googleNanoBanana.enabled,
  );

  next.painter.googleNanoBanana.model = normalizeString(
    getSetting(OHM_EXTENSION_NAME, "painter-google-model", next.painter.googleNanoBanana.model),
    next.painter.googleNanoBanana.model,
  );

  next.painter.openai.enabled = normalizeBoolean(
    getSetting(
      OHM_EXTENSION_NAME,
      "painter-openai-enabled",
      next.painter.openai.enabled ? "on" : "off",
    ),
    next.painter.openai.enabled,
  );

  next.painter.openai.model = normalizeString(
    getSetting(OHM_EXTENSION_NAME, "painter-openai-model", next.painter.openai.model),
    next.painter.openai.model,
  );

  next.painter.azureOpenai.enabled = normalizeBoolean(
    getSetting(
      OHM_EXTENSION_NAME,
      "painter-azure-enabled",
      next.painter.azureOpenai.enabled ? "on" : "off",
    ),
    next.painter.azureOpenai.enabled,
  );

  next.painter.azureOpenai.deployment = normalizeString(
    getSetting(OHM_EXTENSION_NAME, "painter-azure-deployment", next.painter.azureOpenai.deployment),
    next.painter.azureOpenai.deployment,
  );

  next.painter.azureOpenai.endpoint = normalizeString(
    getSetting(OHM_EXTENSION_NAME, "painter-azure-endpoint", next.painter.azureOpenai.endpoint),
    next.painter.azureOpenai.endpoint,
  );

  next.painter.azureOpenai.apiVersion = normalizeString(
    getSetting(
      OHM_EXTENSION_NAME,
      "painter-azure-api-version",
      next.painter.azureOpenai.apiVersion,
    ),
    next.painter.azureOpenai.apiVersion,
  );

  return next;
}

export async function loadOhmRuntimeConfig(cwd: string): Promise<LoadedOhmRuntimeConfig> {
  const paths = resolveOhmConfigPaths(cwd);
  let config = structuredClone(DEFAULT_OHM_CONFIG);
  const loadedFrom: string[] = [];

  const globalConfig = await readJsonFile(paths.globalConfigFile);
  if (globalConfig) {
    config = mergeConfig(config, globalConfig);
    loadedFrom.push(paths.globalConfigFile);
  }

  const projectConfig = await readJsonFile(paths.projectConfigFile);
  if (projectConfig) {
    config = mergeConfig(config, projectConfig);
    loadedFrom.push(paths.projectConfigFile);
  }

  const providersConfig = await readJsonFile(paths.providersConfigFile);
  if (providersConfig) {
    config = mergeConfig(config, { painter: providersConfig });
    loadedFrom.push(paths.providersConfigFile);
  }

  config = applyExtensionSettings(config);

  return {
    config,
    paths,
    loadedFrom,
  };
}

let didRegisterSettings = false;

export function registerOhmSettings(pi: ExtensionAPI): void {
  if (didRegisterSettings) return;
  didRegisterSettings = true;

  const settings: SettingDefinition[] = [
    {
      id: "default-mode",
      label: "Default Mode",
      description: "Primary working mode for Pi Ohm",
      defaultValue: DEFAULT_OHM_CONFIG.defaultMode,
      values: ["rush", "smart", "deep"],
    },
    {
      id: "subagent-backend",
      label: "Subagent Backend",
      description: "How Pi Ohm should delegate subagents",
      defaultValue: DEFAULT_OHM_CONFIG.subagentBackend,
      values: ["interactive-shell", "interactive-sdk", "custom-plugin", "none"],
    },
    {
      id: "feature-handoff",
      label: "Feature: Handoff",
      defaultValue: "on",
      values: ["on", "off"],
    },
    {
      id: "feature-subagents",
      label: "Feature: Subagents",
      defaultValue: "on",
      values: ["on", "off"],
    },
    {
      id: "feature-session-thread-search",
      label: "Feature: Session/Thread Search",
      defaultValue: "on",
      values: ["on", "off"],
    },
    {
      id: "feature-handoff-visualizer",
      label: "Feature: Handoff Visualizer",
      defaultValue: "on",
      values: ["on", "off"],
    },
    {
      id: "feature-painter-imagegen",
      label: "Feature: Painter/ImageGen",
      defaultValue: "on",
      values: ["on", "off"],
    },
    {
      id: "painter-google-enabled",
      label: "Painter Provider: Google Nano Banana",
      defaultValue: "on",
      values: ["on", "off"],
    },
    {
      id: "painter-google-model",
      label: "Painter Provider: Google Model",
      defaultValue: DEFAULT_OHM_CONFIG.painter.googleNanoBanana.model,
    },
    {
      id: "painter-openai-enabled",
      label: "Painter Provider: OpenAI",
      defaultValue: "on",
      values: ["on", "off"],
    },
    {
      id: "painter-openai-model",
      label: "Painter Provider: OpenAI Model",
      defaultValue: DEFAULT_OHM_CONFIG.painter.openai.model,
    },
    {
      id: "painter-azure-enabled",
      label: "Painter Provider: Azure OpenAI",
      defaultValue: "off",
      values: ["on", "off"],
    },
    {
      id: "painter-azure-deployment",
      label: "Painter Provider: Azure Deployment",
      defaultValue: "",
    },
    {
      id: "painter-azure-endpoint",
      label: "Painter Provider: Azure Endpoint",
      defaultValue: "",
    },
    {
      id: "painter-azure-api-version",
      label: "Painter Provider: Azure API Version",
      defaultValue: DEFAULT_OHM_CONFIG.painter.azureOpenai.apiVersion,
    },
  ];

  pi.events.emit("pi-extension-settings:register", {
    name: OHM_EXTENSION_NAME,
    settings,
  });
}

export function getOhmSetting(settingId: string, defaultValue?: string): string | undefined {
  return getSetting(OHM_EXTENSION_NAME, settingId, defaultValue);
}

export function setOhmSetting(settingId: string, value: string): void {
  setSetting(OHM_EXTENSION_NAME, settingId, value);
}

export function getDefaultOhmConfig(): OhmRuntimeConfig {
  return structuredClone(DEFAULT_OHM_CONFIG);
}

export { DEFAULT_OHM_FEATURE_FLAGS, mergeOhmFeatureFlags, type OhmFeatureFlags } from "./features";
export { DEFAULT_OHM_MODE, normalizeOhmMode, type OhmMode } from "./modes";
export {
  DEFAULT_OHM_PAINTER_PROVIDERS,
  mergeOhmPainterProviders,
  type OhmPainterProviders,
} from "./painter";

export {
  DEFAULT_OHM_SUBAGENT_RUNTIME_CONFIG,
  getSubagentConfiguredModel,
  getSubagentProfileRuntimeConfig,
  mergeSubagentRuntimeConfig,
  resolveSubagentProfileRuntimeConfig,
  resolveSubagentVariantPattern,
  type OhmSubagentProfileRuntimeConfig,
  type OhmSubagentProfileVariantRuntimeConfig,
  type OhmSubagentRuntimeConfig,
  type OhmSubagentToolPermissionDecision,
  type ResolvedOhmSubagentProfileRuntimeConfig,
} from "./subagents";

export {
  parseSubagentProfilePatch,
  parseSubagentProfileVariantPatch,
  SubagentProfilePatchSchema,
  SubagentProfileVariantMapPatchSchema,
  SubagentProfileVariantPatchSchema,
  SubagentToolPermissionDecisionSchema,
  SubagentToolPermissionMapSchema,
  type SubagentProfilePatch,
  type SubagentProfileVariantPatch,
  type SubagentToolPermissionDecisionPatch,
} from "./subagents";
