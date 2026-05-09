import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
  return config;
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

export function registerOhmSettings(_pi: ExtensionAPI): void {}

export function getOhmSetting(settingId: string, defaultValue?: string): string | undefined {
  return defaultValue;
}

export function setOhmSetting(settingId: string, value: string): void {
  void settingId;
  void value;
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
