import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getSetting,
  setSetting,
  type SettingDefinition,
} from "@juanibiapina/pi-extension-settings";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const EXTENSION = "pi-ohm-memories";

export interface MemoriesConfig {
  readonly useMemories: boolean;
  readonly generateMemories: boolean;
  readonly maxSummaryChars: number;
  readonly maxRawMemoriesForConsolidation: number;
  readonly maxUnusedDays: number;
  readonly maxRolloutAgeDays: number;
  readonly maxRolloutsPerStartup: number;
  readonly minRolloutIdleHours: number;
  readonly minRateLimitRemainingPercent: number;
  readonly extractModel: string;
  readonly consolidationModel: string;
}

export const DEFAULT_MEMORIES_CONFIG: MemoriesConfig = {
  useMemories: true,
  generateMemories: true,
  maxSummaryChars: 20000,
  maxRawMemoriesForConsolidation: 256,
  maxUnusedDays: 30,
  maxRolloutAgeDays: 10,
  maxRolloutsPerStartup: 2,
  minRolloutIdleHours: 6,
  minRateLimitRemainingPercent: 25,
  extractModel: "openai/gpt-5.4-mini",
  consolidationModel: "openai/gpt-5.4",
};

interface ConfigPaths {
  readonly global: string;
  readonly project: string;
}

type Json = Record<string, unknown>;

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
    global: path.join(dir, "ohm.json"),
    project: path.join(cwd, ".pi", "ohm.json"),
  };
}

async function readJson(file: string): Promise<Json | undefined> {
  const result = await fs.readFile(file, "utf8").then(
    (raw) => JSON.parse(raw),
    () => undefined,
  );
  if (!isJson(result)) return undefined;
  return result;
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

  return {
    useMemories: bool(source.useMemories, base.useMemories),
    generateMemories: bool(source.generateMemories, base.generateMemories),
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
  };
}

function memoriesPatch(config: Json | undefined): unknown {
  if (!config) return undefined;
  return config.memories;
}

function applySettings(config: MemoriesConfig): MemoriesConfig {
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

export async function loadMemoriesConfig(cwd: string): Promise<MemoriesConfig> {
  const paths = resolveConfigPaths(cwd);
  const global = await readJson(paths.global);
  const project = await readJson(paths.project);
  const merged = mergeMemoriesConfig(
    mergeMemoriesConfig(DEFAULT_MEMORIES_CONFIG, memoriesPatch(global)),
    memoriesPatch(project),
  );
  return applySettings(merged);
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
      description: "Allow @pi-ohm/memories to store session memory snapshots.",
      defaultValue: "on",
      values: ["on", "off"],
    },
  ];

  pi.events.emit("pi-extension-settings:register", {
    name: EXTENSION,
    settings,
  });
}

export function setMemoriesSetting(
  id: "use-memories" | "generate-memories",
  value: "on" | "off",
): void {
  setSetting(EXTENSION, id, value);
}
