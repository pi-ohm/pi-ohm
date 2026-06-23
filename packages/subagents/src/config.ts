import { Result } from "better-result";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { registerConfig } from "@pi-ohm/core/config";
import {
  parseSubagentsExperimentalConfigPatch,
  parseSubagentAgentPatch,
  SubagentsConfigSchema,
  SubagentsExperimentalConfigPatchSchema,
  SubagentAgentPatchSchema,
  SubagentToolPermissionDecisionSchema,
  SubagentToolPermissionMapSchema,
  SummarizeHistoryConfigPatchSchema,
  SummarizeHistoryTypeSchema,
  type SubagentsConfigPatch,
  type SubagentsExperimentalConfigPatch,
  type SubagentAgentPatch,
  type SummarizeHistoryConfigPatch,
  type SummarizeHistoryType,
} from "./schema";

const SubagentRuntimeAgentsSchema = Type.Record(
  Type.String({ minLength: 1 }),
  SubagentAgentPatchSchema,
);
const SummarizeHistoryRuntimeConfigSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    type: Type.Union([Type.Literal("branch"), Type.Literal("compact")]),
  },
  { additionalProperties: false },
);
const SubagentsExperimentalRuntimeConfigSchema = Type.Object(
  { summarize_history: SummarizeHistoryRuntimeConfigSchema },
  { additionalProperties: false },
);
const SubagentRuntimeConfigSchema = Type.Object(
  {
    agents: SubagentRuntimeAgentsSchema,
    experimental: SubagentsExperimentalRuntimeConfigSchema,
  },
  { additionalProperties: false },
);

export interface SubagentsConfig {
  readonly subagents: SubagentRuntimeConfig;
}

export interface SummarizeHistoryRuntimeConfig {
  readonly enabled: boolean;
  readonly type: SummarizeHistoryType;
}

export interface SubagentsExperimentalRuntimeConfig {
  readonly summarize_history: SummarizeHistoryRuntimeConfig;
}

export interface SubagentAgentRuntimeConfig {
  disabled?: boolean;
  model?: string;
  tools?: readonly string[];
  maxTurns?: number;
  prompt?: string;
  description?: string;
  permissions?: Readonly<Record<string, SubagentToolPermissionDecision>>;
}

export type SubagentToolPermissionDecision = "allow" | "deny";

export interface ResolvedSubagentAgentRuntimeConfig {
  disabled: boolean;
  model?: string;
  tools?: readonly string[];
  maxTurns?: number;
  prompt?: string;
  description?: string;
  permissions: Readonly<Record<string, "allow" | "deny">>;
}

export interface SubagentRuntimeConfig {
  readonly agents: Record<string, SubagentAgentRuntimeConfig>;
  readonly experimental: SubagentsExperimentalRuntimeConfig;
}

interface RuntimeConfigWithSubagents {
  readonly subagents?: SubagentRuntimeConfig;
}

export const DEFAULT_SUBAGENT_RUNTIME_CONFIG: SubagentRuntimeConfig = {
  agents: {},
  experimental: {
    summarize_history: {
      enabled: false,
      type: "branch",
    },
  },
};

export const subagentsConfigModule = registerConfig({
  namespace: "subagents",
  schema: SubagentsConfigSchema,
  defaults: DEFAULT_SUBAGENT_RUNTIME_CONFIG,
  merge(base: SubagentRuntimeConfig, patch: SubagentsConfigPatch) {
    return Result.ok(
      mergeSubagentRuntimeConfig({
        current: base,
        patch,
      }),
    );
  },
});

function normalizeOptionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

function normalizeStringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  if (normalized.length === 0) return undefined;
  return normalized;
}

function normalizeSubagentToolPermissionDecision(
  value: unknown,
): SubagentToolPermissionDecision | undefined {
  if (value === "allow" || value === "deny") return value;
  return undefined;
}

function normalizeSubagentToolPermissionMap(
  value: SubagentAgentPatch["permissions"] | undefined,
  fallback: Readonly<Record<string, SubagentToolPermissionDecision>>,
): Readonly<Record<string, SubagentToolPermissionDecision>> {
  const normalized: Record<string, SubagentToolPermissionDecision> = { ...fallback };
  for (const [rawToolName, rawDecision] of Object.entries(value ?? {})) {
    const toolName = rawToolName.trim().toLowerCase();
    if (toolName.length === 0) continue;

    const decision = normalizeSubagentToolPermissionDecision(rawDecision);
    if (!decision) continue;
    normalized[toolName] = decision;
  }

  return normalized;
}

export function normalizeSubagentModelOverride(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) return undefined;

  const provider = trimmed.slice(0, slashIndex).trim().toLowerCase();
  const model = trimmed.slice(slashIndex + 1).trim();
  if (provider.length === 0 || model.length === 0) return undefined;

  return `${provider}/${model}`;
}

function mergeSubagentAgentConfig(
  patch: unknown,
  fallback: SubagentAgentRuntimeConfig | undefined,
): SubagentAgentRuntimeConfig | undefined {
  const parsedPatch = parseSubagentAgentPatch(patch);
  if (!parsedPatch) return fallback;

  const disabled = parsedPatch.disabled;
  const model = normalizeSubagentModelOverride(parsedPatch.model);
  const tools = normalizeStringList(parsedPatch.tools);
  const maxTurns = normalizeOptionalPositiveInteger(parsedPatch.maxTurns);
  const prompt = parsedPatch.prompt;
  const description = parsedPatch.description;
  const permissions = normalizeSubagentToolPermissionMap(
    parsedPatch.permissions,
    fallback?.permissions ?? {},
  );

  const merged: SubagentAgentRuntimeConfig = {
    ...fallback,
    ...(disabled !== undefined ? { disabled } : {}),
    ...(model ? { model } : {}),
    ...(tools ? { tools } : {}),
    ...(maxTurns ? { maxTurns } : {}),
    ...(prompt ? { prompt } : {}),
    ...(description ? { description } : {}),
    ...(Object.keys(permissions).length > 0 ? { permissions } : {}),
  };

  const hasValues =
    merged.disabled !== undefined ||
    merged.model !== undefined ||
    merged.tools !== undefined ||
    merged.maxTurns !== undefined ||
    merged.prompt !== undefined ||
    merged.description !== undefined ||
    merged.permissions !== undefined;

  if (!hasValues) return undefined;
  return merged;
}

function normalizeInlineSubagentAgents(
  value: SubagentsConfigPatch | undefined,
  fallback: Record<string, SubagentAgentRuntimeConfig>,
): Record<string, SubagentAgentRuntimeConfig> {
  const normalized = structuredClone(fallback);
  if (!value) return normalized;

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim().toLowerCase();
    if (key.length === 0) continue;
    if (key === "experimental") continue;

    const merged = mergeSubagentAgentConfig(rawValue, normalized[key]);
    if (!merged) continue;
    normalized[key] = merged;
  }

  return normalized;
}

function mergeSummarizeHistoryConfig(
  patch: SummarizeHistoryConfigPatch | undefined,
  fallback: SummarizeHistoryRuntimeConfig,
): SummarizeHistoryRuntimeConfig {
  return {
    enabled: patch?.enabled ?? fallback.enabled,
    type: patch?.type ?? fallback.type,
  };
}

function mergeExperimentalConfig(
  patch: SubagentsExperimentalConfigPatch | undefined,
  fallback: SubagentsExperimentalRuntimeConfig,
): SubagentsExperimentalRuntimeConfig {
  const parsed = parseSubagentsExperimentalConfigPatch(patch);

  return {
    summarize_history: mergeSummarizeHistoryConfig(
      parsed?.summarize_history,
      fallback.summarize_history,
    ),
  };
}

export function mergeSubagentRuntimeConfig(input: {
  readonly current: SubagentRuntimeConfig | undefined;
  readonly patch: SubagentsConfigPatch | undefined;
}): SubagentRuntimeConfig {
  const defaults = input.current ?? DEFAULT_SUBAGENT_RUNTIME_CONFIG;
  const agents = normalizeInlineSubagentAgents(input.patch, defaults.agents);
  const experimental = mergeExperimentalConfig(input.patch?.experimental, defaults.experimental);

  return {
    agents,
    experimental,
  };
}

export function getSummarizeHistoryConfig(
  config: RuntimeConfigWithSubagents,
): SummarizeHistoryRuntimeConfig {
  return (
    config.subagents?.experimental.summarize_history ?? {
      ...DEFAULT_SUBAGENT_RUNTIME_CONFIG.experimental.summarize_history,
    }
  );
}

export function getSubagentConfiguredModel(
  config: RuntimeConfigWithSubagents,
  subagentId: string,
): string | undefined {
  const key = subagentId.trim().toLowerCase();
  if (key.length === 0) return undefined;
  return config.subagents?.agents[key]?.model;
}

export function getSubagentAgentRuntimeConfig(
  config: RuntimeConfigWithSubagents,
  subagentId: string,
): SubagentAgentRuntimeConfig | undefined {
  const key = subagentId.trim().toLowerCase();
  if (key.length === 0) return undefined;
  return config.subagents?.agents[key];
}

function applyToolPermissions(
  permissions: Readonly<Record<string, SubagentToolPermissionDecision>> | undefined,
): Readonly<Record<string, "allow" | "deny">> {
  const resolved: Record<string, "allow" | "deny"> = {};

  for (const [tool, decision] of Object.entries(permissions ?? {})) {
    resolved[tool] = decision;
  }

  return resolved;
}
export function resolveSubagentAgentRuntimeConfig(input: {
  readonly config: RuntimeConfigWithSubagents;
  readonly subagentId: string;
  readonly modelPattern?: string;
}): ResolvedSubagentAgentRuntimeConfig | undefined {
  const agent = getSubagentAgentRuntimeConfig(input.config, input.subagentId);
  if (!agent) return undefined;

  return {
    disabled: agent.disabled ?? false,
    model: agent.model,
    tools: agent.tools,
    maxTurns: agent.maxTurns,
    prompt: agent.prompt,
    description: agent.description,
    permissions: applyToolPermissions(agent.permissions),
  };
}

export function isSubagentRuntimeConfig(value: unknown): value is SubagentRuntimeConfig {
  return Value.Check(SubagentRuntimeConfigSchema, value);
}

export {
  parseSubagentAgentPatch,
  parseSubagentsExperimentalConfigPatch,
  SubagentsConfigSchema,
  SubagentsExperimentalConfigPatchSchema,
  SubagentAgentPatchSchema,
  SubagentToolPermissionDecisionSchema,
  SubagentToolPermissionMapSchema,
  SummarizeHistoryConfigPatchSchema,
  SummarizeHistoryTypeSchema,
  type SubagentsConfigPatch,
  type SubagentsExperimentalConfigPatch,
  type SubagentAgentPatch,
  type SummarizeHistoryConfigPatch,
  type SummarizeHistoryType,
};
