import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveOhmConfigDir } from "@pi-ohm/config";

export type PiScopedModelSource =
  | "project_local"
  | "env_pi_config_dir"
  | "env_pi_coding_agent_dir"
  | "env_pi_agent_dir"
  | "resolved_agent_dir"
  | "home_default";

export interface PiScopedModelRecord {
  readonly provider: string;
  readonly modelId: string;
  readonly pattern: string;
}

export interface PiScopedModelCatalog {
  readonly models: readonly PiScopedModelRecord[];
  readonly sourcePath?: string;
  readonly source?: PiScopedModelSource;
  readonly diagnostics: readonly string[];
}

interface PiSettingsCandidatePath {
  readonly source: PiScopedModelSource;
  readonly filePath: string;
}

interface ParsedScopedModelSettingsCacheEntry {
  readonly mtimeMs: number;
  readonly parsed: ParsedScopedModelSettingsResult;
}

type ParsedScopedModelSettingsResult =
  | {
      readonly ok: true;
      readonly models: readonly PiScopedModelRecord[];
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

const PI_SETTINGS_FILE_NAME = "settings.json";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

const parsedScopedModelSettingsCache = new Map<string, ParsedScopedModelSettingsCacheEntry>();

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function stripThinkingSuffix(modelId: string): string {
  const trimmed = modelId.trim();
  if (trimmed.length === 0) return "";

  const colonIndex = trimmed.lastIndexOf(":");
  if (colonIndex <= 0 || colonIndex >= trimmed.length - 1) {
    return trimmed;
  }

  const suffix = normalizeToken(trimmed.slice(colonIndex + 1));
  if (!THINKING_LEVELS.has(suffix)) {
    return trimmed;
  }

  return trimmed.slice(0, colonIndex).trim();
}

function parseModelPattern(value: string): PiScopedModelRecord | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) return undefined;

  const provider = normalizeToken(trimmed.slice(0, slashIndex));
  const rawModel = trimmed.slice(slashIndex + 1).trim();
  const modelId = normalizeToken(stripThinkingSuffix(rawModel));
  if (provider.length === 0 || modelId.length === 0) return undefined;

  return {
    provider,
    modelId,
    pattern: `${provider}/${modelId}`,
  };
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function normalizeDir(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return expandHome(trimmed);
}

function toSettingsPath(configDir: string): string {
  return path.join(configDir, PI_SETTINGS_FILE_NAME);
}

function pushCandidate(
  candidates: PiSettingsCandidatePath[],
  seenPaths: Set<string>,
  source: PiScopedModelSource,
  filePath: string | undefined,
): void {
  if (!filePath) return;
  if (seenPaths.has(filePath)) return;

  seenPaths.add(filePath);
  candidates.push({ source, filePath });
}

export function resolvePiSettingsCandidates(cwd: string): readonly PiSettingsCandidatePath[] {
  const candidates: PiSettingsCandidatePath[] = [];
  const seenPaths = new Set<string>();

  const projectSettingsPath = path.join(cwd, ".pi", "agent", PI_SETTINGS_FILE_NAME);
  pushCandidate(candidates, seenPaths, "project_local", projectSettingsPath);

  const piConfigDir = normalizeDir(process.env.PI_CONFIG_DIR);
  const piCodingAgentDir = normalizeDir(process.env.PI_CODING_AGENT_DIR);
  const piAgentDir = normalizeDir(process.env.PI_AGENT_DIR);

  pushCandidate(
    candidates,
    seenPaths,
    "env_pi_config_dir",
    piConfigDir ? toSettingsPath(piConfigDir) : undefined,
  );
  pushCandidate(
    candidates,
    seenPaths,
    "env_pi_coding_agent_dir",
    piCodingAgentDir ? toSettingsPath(piCodingAgentDir) : undefined,
  );
  pushCandidate(
    candidates,
    seenPaths,
    "env_pi_agent_dir",
    piAgentDir ? toSettingsPath(piAgentDir) : undefined,
  );

  const resolvedAgentSettingsPath = toSettingsPath(resolveOhmConfigDir());
  pushCandidate(candidates, seenPaths, "resolved_agent_dir", resolvedAgentSettingsPath);
  pushCandidate(
    candidates,
    seenPaths,
    "home_default",
    path.join(os.homedir(), ".pi", "agent", PI_SETTINGS_FILE_NAME),
  );

  return candidates;
}

async function readSettingsMtimeMs(filePath: string): Promise<number | undefined> {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return undefined;
    return stats.mtimeMs;
  } catch {
    return undefined;
  }
}

function parseEnabledModels(value: unknown): readonly PiScopedModelRecord[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;

  const normalized: PiScopedModelRecord[] = [];
  const dedupe = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const parsed = parseModelPattern(entry);
    if (!parsed) continue;

    const dedupeKey = `${parsed.provider}/${parsed.modelId}`;
    if (dedupe.has(dedupeKey)) continue;
    dedupe.add(dedupeKey);
    normalized.push(parsed);
  }

  return normalized;
}

async function parseScopedModelSettingsFile(
  filePath: string,
  mtimeMs: number,
): Promise<ParsedScopedModelSettingsResult> {
  const cached = parsedScopedModelSettingsCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.parsed;
  }

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isObjectRecord(parsed)) {
      const invalidShape: ParsedScopedModelSettingsResult = {
        ok: false,
        message: "Settings file must contain a top-level JSON object.",
      };
      parsedScopedModelSettingsCache.set(filePath, { mtimeMs, parsed: invalidShape });
      return invalidShape;
    }

    const models = parseEnabledModels(parsed.enabledModels);
    if (!models) {
      const invalidEnabledModels: ParsedScopedModelSettingsResult = {
        ok: false,
        message: "Settings file field 'enabledModels' must be a string array when present.",
      };
      parsedScopedModelSettingsCache.set(filePath, { mtimeMs, parsed: invalidEnabledModels });
      return invalidEnabledModels;
    }

    const success: ParsedScopedModelSettingsResult = {
      ok: true,
      models,
    };
    parsedScopedModelSettingsCache.set(filePath, { mtimeMs, parsed: success });
    return success;
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message.trim()
        : "invalid JSON";

    const invalidJson: ParsedScopedModelSettingsResult = {
      ok: false,
      message,
    };
    parsedScopedModelSettingsCache.set(filePath, { mtimeMs, parsed: invalidJson });
    return invalidJson;
  }
}

export async function loadPiScopedModelCatalog(cwd: string): Promise<PiScopedModelCatalog> {
  const diagnostics: string[] = [];
  const candidates = resolvePiSettingsCandidates(cwd);

  for (const candidate of candidates) {
    const mtimeMs = await readSettingsMtimeMs(candidate.filePath);
    if (mtimeMs === undefined) continue;

    const parsed = await parseScopedModelSettingsFile(candidate.filePath, mtimeMs);
    if (!parsed.ok) {
      diagnostics.push(`${candidate.filePath}: ${parsed.message}`);
      continue;
    }

    if (parsed.models.length === 0) {
      diagnostics.push(`${candidate.filePath}: no valid enabledModels entries found.`);
    }

    return {
      models: parsed.models,
      sourcePath: candidate.filePath,
      source: candidate.source,
      diagnostics,
    };
  }

  return {
    models: [],
    diagnostics,
  };
}

export function resetPiScopedModelCatalogCache(): void {
  parsedScopedModelSettingsCache.clear();
}
