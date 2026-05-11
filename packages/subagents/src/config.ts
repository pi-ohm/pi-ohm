import { Result } from "better-result";
import { Type, type StaticDecode } from "typebox";
import { registerConfig } from "@pi-ohm/core/config";
import {
  parseSubagentAgentPatch,
  parseSubagentAgentVariantPatch,
  SubagentAgentPatchSchema,
  SubagentAgentVariantMapPatchSchema,
  SubagentAgentVariantPatchSchema,
  SubagentToolPermissionDecisionSchema,
  SubagentToolPermissionMapSchema,
  type SubagentAgentPatch,
  type SubagentAgentVariantPatch,
  type SubagentToolPermissionDecisionPatch,
} from "./schema";

export const SubagentsConfigSchema = Type.Record(Type.String({ minLength: 1 }), Type.Unknown());

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
  variants?: Readonly<Record<string, SubagentAgentVariantRuntimeConfig>>;
}

export type SubagentToolPermissionDecision = "allow" | "deny" | "inherit";

export interface SubagentAgentVariantRuntimeConfig {
  disabled?: boolean;
  model?: string;
  tools?: readonly string[];
  maxTurns?: number;
  prompt?: string;
  description?: string;
  permissions?: Readonly<Record<string, SubagentToolPermissionDecision>>;
}

export interface ResolvedSubagentAgentRuntimeConfig {
  disabled: boolean;
  model?: string;
  tools?: readonly string[];
  maxTurns?: number;
  prompt?: string;
  description?: string;
  permissions: Readonly<Record<string, "allow" | "deny">>;
  variantPattern?: string;
}

export interface SubagentRuntimeConfig {
  agents: Record<string, SubagentAgentRuntimeConfig>;
}

export type SubagentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

function isSubagentThinkingLevel(value: string): value is SubagentThinkingLevel {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

interface JsonMap {
  readonly [key: string]: unknown;
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

function isJsonMap(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  if (value === "allow" || value === "deny" || value === "inherit") return value;

  // Legacy compatibility: treat deprecated "ask" as deny-safe behavior.
  if (value === "ask") return "deny";
  return undefined;
}

function normalizeSubagentToolPermissionDecisionPatch(
  value: SubagentToolPermissionDecisionPatch,
): SubagentToolPermissionDecision {
  if (value === "allow" || value === "deny" || value === "inherit") return value;
  return "deny";
}

function normalizeSubagentToolPermissionMap(
  value: unknown,
  fallback: Readonly<Record<string, SubagentToolPermissionDecision>>,
): Readonly<Record<string, SubagentToolPermissionDecision>> {
  if (!isJsonMap(value)) return fallback;

  const normalized: Record<string, SubagentToolPermissionDecision> = { ...fallback };
  for (const [rawToolName, rawDecision] of Object.entries(value)) {
    const toolName = rawToolName.trim().toLowerCase();
    if (toolName.length === 0) continue;

    const decision = normalizeSubagentToolPermissionDecision(rawDecision);
    if (!decision) continue;
    normalized[toolName] = decision;
  }

  return normalized;
}

function normalizeSubagentVariantPattern(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;
  return trimmed;
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

function stripThinkingSuffix(modelId: string): string {
  const trimmed = modelId.trim();
  if (trimmed.length === 0) return "";

  const colonIndex = trimmed.lastIndexOf(":");
  if (colonIndex <= 0 || colonIndex >= trimmed.length - 1) {
    return trimmed;
  }

  const suffix = trimmed
    .slice(colonIndex + 1)
    .trim()
    .toLowerCase();
  if (!isSubagentThinkingLevel(suffix)) {
    return trimmed;
  }

  return trimmed.slice(0, colonIndex).trim();
}

function mergeSubagentVariantConfig(
  patch: JsonMap,
  fallback: SubagentAgentVariantRuntimeConfig | undefined,
): SubagentAgentVariantRuntimeConfig | undefined {
  const parsedPatch = parseSubagentAgentVariantPatch(patch);
  if (!parsedPatch) return fallback;

  const disabled = parsedPatch.disabled;
  const model = normalizeSubagentModelOverride(parsedPatch.model);
  const tools = normalizeStringList(parsedPatch.tools);
  const maxTurns = normalizeOptionalPositiveInteger(parsedPatch.maxTurns);
  const prompt = parsedPatch.prompt;
  const description = parsedPatch.description;
  const normalizedPermissionsInput = parsedPatch.permissions
    ? Object.fromEntries(
        Object.entries(parsedPatch.permissions).map(([tool, decision]) => [
          tool,
          normalizeSubagentToolPermissionDecisionPatch(decision),
        ]),
      )
    : undefined;
  const permissions = normalizeSubagentToolPermissionMap(
    normalizedPermissionsInput,
    fallback?.permissions ?? {},
  );

  const merged: SubagentAgentVariantRuntimeConfig = {
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

function normalizeSubagentVariantMap(
  value: unknown,
  fallback: Readonly<Record<string, SubagentAgentVariantRuntimeConfig>>,
): Readonly<Record<string, SubagentAgentVariantRuntimeConfig>> {
  if (!isJsonMap(value)) return fallback;

  const merged: Record<string, SubagentAgentVariantRuntimeConfig> = { ...fallback };
  for (const [rawPattern, rawVariant] of Object.entries(value)) {
    const pattern = normalizeSubagentVariantPattern(rawPattern);
    if (!pattern) continue;
    if (!isJsonMap(rawVariant)) continue;

    const variant = mergeSubagentVariantConfig(rawVariant, merged[pattern]);
    if (!variant) continue;
    merged[pattern] = variant;
  }

  return merged;
}

function mergeSubagentAgentConfig(
  patch: JsonMap,
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
  const normalizedPermissionsInput = parsedPatch.permissions
    ? Object.fromEntries(
        Object.entries(parsedPatch.permissions).map(([tool, decision]) => [
          tool,
          normalizeSubagentToolPermissionDecisionPatch(decision),
        ]),
      )
    : undefined;
  const permissions = normalizeSubagentToolPermissionMap(
    normalizedPermissionsInput,
    fallback?.permissions ?? {},
  );
  const variants = normalizeSubagentVariantMap(parsedPatch.variants, fallback?.variants ?? {});

  const merged: SubagentAgentRuntimeConfig = {
    ...fallback,
    ...(disabled !== undefined ? { disabled } : {}),
    ...(model ? { model } : {}),
    ...(tools ? { tools } : {}),
    ...(maxTurns ? { maxTurns } : {}),
    ...(prompt ? { prompt } : {}),
    ...(description ? { description } : {}),
    ...(Object.keys(permissions).length > 0 ? { permissions } : {}),
    ...(Object.keys(variants).length > 0 ? { variants } : {}),
  };

  const hasValues =
    merged.disabled !== undefined ||
    merged.model !== undefined ||
    merged.tools !== undefined ||
    merged.maxTurns !== undefined ||
    merged.prompt !== undefined ||
    merged.description !== undefined ||
    merged.permissions !== undefined ||
    merged.variants !== undefined;

  if (!hasValues) return undefined;
  return merged;
}

function normalizeInlineSubagentAgents(
  value: JsonMap | undefined,
  fallback: Record<string, SubagentAgentRuntimeConfig>,
): Record<string, SubagentAgentRuntimeConfig> {
  const normalized = structuredClone(fallback);
  if (!value) return normalized;

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim().toLowerCase();
    if (key.length === 0) continue;
    if (!isJsonMap(rawValue)) continue;

    const merged = mergeSubagentAgentConfig(rawValue, normalized[key]);
    if (!merged) continue;
    normalized[key] = merged;
  }

  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toWildcardRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((segment) => escapeRegExp(segment))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i");
}

function toModelVariantCandidates(modelPattern: string | undefined): readonly string[] {
  if (!modelPattern) return [];

  const normalized = normalizeSubagentModelOverride(modelPattern);
  if (!normalized) return [];

  const slashIndex = normalized.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= normalized.length - 1) return [];

  const provider = normalized.slice(0, slashIndex);
  const modelWithThinking = normalized.slice(slashIndex + 1);
  const modelId = stripThinkingSuffix(modelWithThinking).trim().toLowerCase();
  if (provider.length === 0 || modelId.length === 0) return [];

  return [`${provider}/${modelId}`, modelId];
}

export function mergeSubagentRuntimeConfig(input: {
  readonly current: SubagentRuntimeConfig | undefined;
  readonly patch: unknown;
}): SubagentRuntimeConfig {
  const patch = isJsonMap(input.patch) ? input.patch : undefined;
  const defaults = input.current ?? DEFAULT_SUBAGENT_RUNTIME_CONFIG;
  const agents = normalizeInlineSubagentAgents(patch, defaults.agents);

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

export function resolveSubagentVariantPattern(input: {
  readonly variants: Readonly<Record<string, SubagentAgentVariantRuntimeConfig>> | undefined;
  readonly modelPattern: string | undefined;
}): string | undefined {
  if (!input.variants) return undefined;

  const candidates = toModelVariantCandidates(input.modelPattern);
  if (candidates.length === 0) return undefined;

  const patterns = Object.keys(input.variants).reverse();
  for (const pattern of patterns) {
    const normalizedPattern = normalizeSubagentVariantPattern(pattern);
    if (!normalizedPattern) continue;
    const matcher = toWildcardRegExp(normalizedPattern);
    if (candidates.some((candidate) => matcher.test(candidate))) {
      return normalizedPattern;
    }
  }

  return undefined;
}

function applyInheritedToolPermissions(input: {
  readonly base: Readonly<Record<string, SubagentToolPermissionDecision>> | undefined;
  readonly override: Readonly<Record<string, SubagentToolPermissionDecision>> | undefined;
}): Readonly<Record<string, "allow" | "deny">> {
  const resolved: Record<string, "allow" | "deny"> = {};

  for (const [tool, decision] of Object.entries(input.base ?? {})) {
    if (decision === "allow" || decision === "deny") {
      resolved[tool] = decision;
    }
  }

  for (const [tool, decision] of Object.entries(input.override ?? {})) {
    if (decision === "inherit") {
      if (!input.base || input.base[tool] === undefined) {
        delete resolved[tool];
      }
      continue;
    }

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

  const variantPattern = resolveSubagentVariantPattern({
    variants: agent.variants,
    modelPattern: input.modelPattern ?? agent.model,
  });
  const variant = variantPattern ? agent.variants?.[variantPattern] : undefined;

  const permissions = applyInheritedToolPermissions({
    base: agent.permissions,
    override: variant?.permissions,
  });

  return {
    disabled: variant?.disabled ?? agent.disabled ?? false,
    model: variant?.model ?? agent.model,
    tools: variant?.tools ?? agent.tools,
    maxTurns: variant?.maxTurns ?? agent.maxTurns,
    prompt: variant?.prompt ?? agent.prompt,
    description: variant?.description ?? agent.description,
    permissions,
    ...(variantPattern ? { variantPattern } : {}),
  };
}

export function isSubagentRuntimeConfig(value: unknown): value is SubagentRuntimeConfig {
  if (!isJsonMap(value)) return false;
  return isJsonMap(value.agents);
}

export {
  parseSubagentAgentPatch,
  parseSubagentAgentVariantPatch,
  SubagentAgentPatchSchema,
  SubagentAgentVariantMapPatchSchema,
  SubagentAgentVariantPatchSchema,
  SubagentToolPermissionDecisionSchema,
  SubagentToolPermissionMapSchema,
  type SubagentAgentPatch,
  type SubagentAgentVariantPatch,
  type SubagentToolPermissionDecisionPatch,
};
