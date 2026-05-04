import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getSetting, type SettingDefinition } from "@juanibiapina/pi-extension-settings";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Result, TaggedError, type Result as BetterResult } from "better-result";

const EXTENSION = "pi-ohm-memories";

export class MemoryConfigError extends TaggedError("MemoryConfigError")<{
  readonly code: "config_read_failed" | "config_parse_failed";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}>() {}

export type MemoryConfigResult<T> = BetterResult<T, MemoryConfigError>;

export interface MemoriesConfig {
  readonly disableOnExternalContext: boolean;
  readonly generateMemories: boolean;
  readonly useMemories: boolean;
  readonly maxSummaryChars: number;
  readonly maxRawMemoriesForConsolidation: number;
  readonly maxUnusedDays: number;
  readonly maxRolloutAgeDays: number;
  readonly maxRolloutsPerStartup: number;
  readonly minRolloutIdleHours: number;
  readonly minRateLimitRemainingPercent: number;
  readonly extractModel: string;
  readonly consolidationModel: string;
  readonly subprocessTimeoutMs: number;
  readonly phase2CooldownHours: number;
}

export const DEFAULT_MEMORIES_CONFIG: MemoriesConfig = {
  disableOnExternalContext: false,
  generateMemories: true,
  useMemories: true,
  maxSummaryChars: 20000,
  maxRawMemoriesForConsolidation: 256,
  maxUnusedDays: 30,
  maxRolloutAgeDays: 10,
  maxRolloutsPerStartup: 2,
  minRolloutIdleHours: 6,
  minRateLimitRemainingPercent: 25,
  extractModel: "openai/gpt-5.4-mini",
  consolidationModel: "openai/gpt-5.4",
  subprocessTimeoutMs: 600000,
  phase2CooldownHours: 6,
};

interface ConfigPaths {
  readonly globalOhm: string;
  readonly projectOhm: string;
  readonly globalSettings: string;
  readonly projectSettings: string;
}

type Json = Record<string, unknown>;

function errorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("code" in value)) return undefined;
  return typeof value.code === "string" ? value.code : undefined;
}

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolveConfigDir(): string {
  const env =
    process.env.PI_CONFIG_DIR ?? process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR;
  if (env && env.trim().length > 0) return expandHome(env.trim());
  return path.join(os.homedir(), ".pi", "agent");
}

function resolveConfigPaths(cwd: string): ConfigPaths {
  const dir = resolveConfigDir();
  return {
    globalOhm: path.join(dir, "ohm.json"),
    projectOhm: path.join(cwd, ".pi", "ohm.json"),
    globalSettings: path.join(dir, "settings.json"),
    projectSettings: path.join(cwd, ".pi", "settings.json"),
  };
}

async function readConfigJson(file: string): Promise<MemoryConfigResult<Json | undefined>> {
  const raw = await Result.tryPromise({
    try: async () => fs.readFile(file, "utf8"),
    catch: (cause) =>
      new MemoryConfigError({
        code: "config_read_failed",
        path: file,
        message: `Failed to read memories config: ${file}`,
        cause,
      }),
  });
  if (Result.isError(raw)) {
    if (errorCode(raw.error.cause) === "ENOENT") return Result.ok(undefined);
    return raw;
  }

  const parsed = Result.try({
    try: () => JSON.parse(raw.value),
    catch: (cause) =>
      new MemoryConfigError({
        code: "config_parse_failed",
        path: file,
        message: `Failed to parse memories config JSON: ${file}`,
        cause,
      }),
  });
  if (Result.isError(parsed)) return parsed;
  if (!isJson(parsed.value)) {
    return Result.err(
      new MemoryConfigError({
        code: "config_parse_failed",
        path: file,
        message: `Memories config must be a JSON object: ${file}`,
      }),
    );
  }
  return Result.ok(parsed.value);
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number") return fallback;
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function str(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return trimmed;
}

export function mergeMemoriesConfig(base: MemoriesConfig, patch: unknown): MemoriesConfig {
  const source = isJson(patch) ? patch : {};
  const disable = source.disableOnExternalContext ?? source.noMemoriesIfMcpOrWebSearch;

  return {
    disableOnExternalContext: bool(disable, base.disableOnExternalContext),
    generateMemories: bool(source.generateMemories, base.generateMemories),
    useMemories: bool(source.useMemories, base.useMemories),
    maxSummaryChars: int(source.maxSummaryChars, base.maxSummaryChars, 1000, 200000),
    maxRawMemoriesForConsolidation: int(
      source.maxRawMemoriesForConsolidation,
      base.maxRawMemoriesForConsolidation,
      1,
      4096,
    ),
    maxUnusedDays: int(source.maxUnusedDays, base.maxUnusedDays, 0, 365),
    maxRolloutAgeDays: int(source.maxRolloutAgeDays, base.maxRolloutAgeDays, 0, 90),
    maxRolloutsPerStartup: int(source.maxRolloutsPerStartup, base.maxRolloutsPerStartup, 1, 128),
    minRolloutIdleHours: int(source.minRolloutIdleHours, base.minRolloutIdleHours, 1, 48),
    minRateLimitRemainingPercent: int(
      source.minRateLimitRemainingPercent,
      base.minRateLimitRemainingPercent,
      0,
      100,
    ),
    extractModel: str(source.extractModel, base.extractModel),
    consolidationModel: str(source.consolidationModel, base.consolidationModel),
    subprocessTimeoutMs: int(source.subprocessTimeoutMs, base.subprocessTimeoutMs, 30000, 3600000),
    phase2CooldownHours: int(source.phase2CooldownHours, base.phase2CooldownHours, 0, 168),
  };
}

function memoriesPatch(config: Json | undefined): unknown {
  if (!config) return undefined;
  return config.memories;
}

function applyExtensionSettings(config: MemoriesConfig): MemoriesConfig {
  return {
    ...config,
    useMemories: bool(
      getSetting(EXTENSION, "use-memories", config.useMemories ? "on" : "off"),
      config.useMemories,
    ),
    generateMemories: bool(
      getSetting(EXTENSION, "generate-memories", config.generateMemories ? "on" : "off"),
      config.generateMemories,
    ),
  };
}

export async function loadMemoriesConfig(cwd: string): Promise<MemoryConfigResult<MemoriesConfig>> {
  const paths = resolveConfigPaths(cwd);
  const globalOhm = await readConfigJson(paths.globalOhm);
  if (Result.isError(globalOhm)) return globalOhm;
  const projectOhm = await readConfigJson(paths.projectOhm);
  if (Result.isError(projectOhm)) return projectOhm;
  const globalSettings = await readConfigJson(paths.globalSettings);
  if (Result.isError(globalSettings)) return globalSettings;
  const projectSettings = await readConfigJson(paths.projectSettings);
  if (Result.isError(projectSettings)) return projectSettings;
  const merged = [
    globalOhm.value,
    globalSettings.value,
    projectOhm.value,
    projectSettings.value,
  ].reduce(
    (config, source) => mergeMemoriesConfig(config, memoriesPatch(source)),
    DEFAULT_MEMORIES_CONFIG,
  );
  return Result.ok(applyExtensionSettings(merged));
}

let didRegister = false;

export function registerMemoriesSettings(pi: ExtensionAPI): void {
  if (didRegister) return;
  didRegister = true;

  const settings: SettingDefinition[] = [
    {
      id: "use-memories",
      label: "Use Memories",
      description: "Inject memory_summary.md into future Pi turns.",
      defaultValue: "on",
      values: ["on", "off"],
    },
    {
      id: "generate-memories",
      label: "Generate Memories",
      description: "Allow @pi-ohm/memories to generate durable memories from sessions.",
      defaultValue: "on",
      values: ["on", "off"],
    },
  ];

  pi.events.emit("pi-extension-settings:register", {
    name: EXTENSION,
    settings,
  });
}
