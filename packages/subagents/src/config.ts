import { Result } from "better-result";
import { Type, type StaticDecode } from "typebox";
import { Value } from "typebox/value";
import { registerConfig } from "@pi-ohm/core/config";
import {
  parseSubagentAgentPatch,
  SubagentAgentPatchSchema,
  SubagentToolPermissionDecisionSchema,
  SubagentToolPermissionMapSchema,
  type SubagentAgentPatch,
} from "./schema";

export const SubagentsConfigSchema = Type.Record(
  Type.String({ minLength: 1 }),
  SubagentAgentPatchSchema,
);
const SubagentRuntimeConfigSchema = Type.Object(
  { agents: SubagentsConfigSchema },
  { additionalProperties: false },
);

type SubagentsConfigPatch = StaticDecode<typeof SubagentsConfigSchema>;

export interface SubagentsConfig {
  readonly subagents: SubagentRuntimeConfig;
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
  agents: Record<string, SubagentAgentRuntimeConfig>;
}

interface RuntimeConfigWithSubagents {
  readonly subagents?: SubagentRuntimeConfig;
}

export const DEFAULT_SUBAGENT_RUNTIME_CONFIG: SubagentRuntimeConfig = {
  agents: {},
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
  patch: SubagentAgentPatch,
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

    const merged = mergeSubagentAgentConfig(rawValue, normalized[key]);
    if (!merged) continue;
    normalized[key] = merged;
  }

  return normalized;
}

export function mergeSubagentRuntimeConfig(input: {
  readonly current: SubagentRuntimeConfig | undefined;
  readonly patch: SubagentsConfigPatch | undefined;
}): SubagentRuntimeConfig {
  const defaults = input.current ?? DEFAULT_SUBAGENT_RUNTIME_CONFIG;
  const agents = normalizeInlineSubagentAgents(input.patch, defaults.agents);

  return {
    agents,
  };
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
  SubagentAgentPatchSchema,
  SubagentToolPermissionDecisionSchema,
  SubagentToolPermissionMapSchema,
  type SubagentAgentPatch,
};
