import fs from "node:fs/promises";
import { resolveOhmConfigPaths } from "@pi-ohm/config";
import {
  DEFAULT_SUBAGENT_PROMPT_PROFILE_RULES,
  isSubagentPromptProfile,
  type SubagentPromptProfileRule,
  type SubagentPromptProfileRuleMetadata,
} from "./system-prompts";

interface PromptProfileRulesCacheEntry {
  readonly mtimeMs: number;
  readonly parsed: LoadedSubagentPromptProfileRules;
}

export interface LoadedSubagentPromptProfileRules {
  readonly rules: readonly SubagentPromptProfileRule[];
  readonly diagnostics: readonly string[];
  readonly sourcePath?: string;
}

const promptProfileRulesCache = new Map<string, PromptProfileRulesCacheEntry>();

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cloneDefaultRules(): readonly SubagentPromptProfileRule[] {
  return DEFAULT_SUBAGENT_PROMPT_PROFILE_RULES.map((rule) => ({
    profile: rule.profile,
    match: {
      providers: [...rule.match.providers],
      models: [...rule.match.models],
    },
    priority: rule.priority,
    metadata: rule.metadata
      ? {
          ...rule.metadata,
        }
      : undefined,
  }));
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeTokens(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const token = normalizeToken(entry);
    if (token.length === 0) continue;
    if (normalized.includes(token)) continue;
    normalized.push(token);
  }

  return normalized;
}

function parseMetadata(value: unknown): SubagentPromptProfileRuleMetadata | undefined {
  if (!isObjectRecord(value)) return undefined;

  const labelRaw = value.label;
  const notesRaw = value.notes;

  const label = typeof labelRaw === "string" ? labelRaw.trim() : "";
  const notes = typeof notesRaw === "string" ? notesRaw.trim() : "";

  const normalizedLabel = label.length > 0 ? label : undefined;
  const normalizedNotes = notes.length > 0 ? notes : undefined;
  if (!normalizedLabel && !normalizedNotes) return undefined;

  return {
    ...(normalizedLabel ? { label: normalizedLabel } : {}),
    ...(normalizedNotes ? { notes: normalizedNotes } : {}),
  };
}

function parsePriority(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.trunc(value);
}

function parseRule(
  value: unknown,
  diagnostics: string[],
  index: number,
): SubagentPromptProfileRule | undefined {
  if (!isObjectRecord(value)) {
    diagnostics.push(`promptProfiles.rules[${index}] must be an object.`);
    return undefined;
  }

  const profile = value.profile;
  if (!isSubagentPromptProfile(profile) || profile === "generic") {
    diagnostics.push(
      `promptProfiles.rules[${index}] has invalid profile '${String(profile)}'. Expected anthropic|openai|google|moonshot.`,
    );
    return undefined;
  }

  const match = value.match;
  if (!isObjectRecord(match)) {
    diagnostics.push(`promptProfiles.rules[${index}] match must be an object.`);
    return undefined;
  }

  const providers = normalizeTokens(match.providers);
  const models = normalizeTokens(match.models);
  if (!providers || !models) {
    diagnostics.push(
      `promptProfiles.rules[${index}] match.providers and match.models must be string arrays.`,
    );
    return undefined;
  }

  if (providers.length === 0 && models.length === 0) {
    diagnostics.push(
      `promptProfiles.rules[${index}] must include at least one provider or model token.`,
    );
    return undefined;
  }

  return {
    profile,
    match: {
      providers,
      models,
    },
    priority: parsePriority(value.priority),
    metadata: parseMetadata(value.metadata),
  };
}

function parseRules(value: unknown): {
  readonly rules: readonly SubagentPromptProfileRule[];
  readonly diagnostics: readonly string[];
} {
  const diagnostics: string[] = [];
  if (!Array.isArray(value)) {
    diagnostics.push("subagents.promptProfiles.rules must be an array.");
    return {
      rules: [],
      diagnostics,
    };
  }

  const parsed: SubagentPromptProfileRule[] = [];
  for (const [index, ruleValue] of value.entries()) {
    const parsedRule = parseRule(ruleValue, diagnostics, index);
    if (!parsedRule) continue;
    parsed.push(parsedRule);
  }

  parsed.sort((left, right) => right.priority - left.priority);

  return {
    rules: parsed,
    diagnostics,
  };
}

function parseProvidersConfig(value: unknown): {
  readonly rules: readonly SubagentPromptProfileRule[];
  readonly diagnostics: readonly string[];
} {
  if (!isObjectRecord(value)) {
    return {
      rules: [],
      diagnostics: ["providers config must be a top-level object."],
    };
  }

  const subagents = value.subagents;
  if (!isObjectRecord(subagents)) {
    return {
      rules: [],
      diagnostics: [],
    };
  }

  const promptProfiles = subagents.promptProfiles;
  if (!isObjectRecord(promptProfiles)) {
    return {
      rules: [],
      diagnostics: [],
    };
  }

  return parseRules(promptProfiles.rules);
}

async function readConfigMtimeMs(filePath: string): Promise<number | undefined> {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return undefined;
    return stats.mtimeMs;
  } catch {
    return undefined;
  }
}

async function parsePromptProfileRulesFile(
  filePath: string,
  mtimeMs: number,
): Promise<LoadedSubagentPromptProfileRules> {
  const cached = promptProfileRulesCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.parsed;
  }

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const result = parseProvidersConfig(parsed);
    const diagnostics = result.diagnostics.map((entry) => `${filePath}: ${entry}`);

    const loaded: LoadedSubagentPromptProfileRules =
      result.rules.length > 0
        ? {
            rules: result.rules,
            diagnostics,
            sourcePath: filePath,
          }
        : {
            rules: cloneDefaultRules(),
            diagnostics: [
              ...diagnostics,
              `${filePath}: no valid prompt profile rules found; using defaults.`,
            ],
            sourcePath: filePath,
          };

    promptProfileRulesCache.set(filePath, { mtimeMs, parsed: loaded });
    return loaded;
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message.trim()
        : "invalid JSON";

    const fallback: LoadedSubagentPromptProfileRules = {
      rules: cloneDefaultRules(),
      diagnostics: [`${filePath}: ${message}`, `${filePath}: using default prompt profile rules.`],
      sourcePath: filePath,
    };
    promptProfileRulesCache.set(filePath, { mtimeMs, parsed: fallback });
    return fallback;
  }
}

export async function loadSubagentPromptProfileRules(
  cwd: string,
): Promise<LoadedSubagentPromptProfileRules> {
  const providersConfigFile = resolveOhmConfigPaths(cwd).providersConfigFile;
  const mtimeMs = await readConfigMtimeMs(providersConfigFile);
  if (mtimeMs === undefined) {
    return {
      rules: cloneDefaultRules(),
      diagnostics: [],
    };
  }

  return parsePromptProfileRulesFile(providersConfigFile, mtimeMs);
}

export function resetSubagentPromptProfileRulesCache(): void {
  promptProfileRulesCache.clear();
}
