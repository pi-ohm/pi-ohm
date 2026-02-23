import {
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
} from "./schema";

export interface OhmSubagentProfileRuntimeConfig {
  model?: string;
  prompt?: string;
  description?: string;
  whenToUse?: readonly string[];
  permissions?: Readonly<Record<string, OhmSubagentToolPermissionDecision>>;
  variants?: Readonly<Record<string, OhmSubagentProfileVariantRuntimeConfig>>;
}

export type OhmSubagentToolPermissionDecision = "allow" | "deny" | "inherit";

export interface OhmSubagentProfileVariantRuntimeConfig {
  model?: string;
  prompt?: string;
  description?: string;
  whenToUse?: readonly string[];
  permissions?: Readonly<Record<string, OhmSubagentToolPermissionDecision>>;
}

export interface ResolvedOhmSubagentProfileRuntimeConfig {
  model?: string;
  prompt?: string;
  description?: string;
  whenToUse?: readonly string[];
  permissions: Readonly<Record<string, "allow" | "deny">>;
  variantPattern?: string;
}

export interface OhmSubagentRuntimeConfig {
  taskMaxConcurrency: number;
  taskRetentionMs: number;
  permissions: {
    default: "allow" | "deny";
    subagents: Record<string, "allow" | "deny">;
    allowInternalRouting: boolean;
  };
  profiles: Record<string, OhmSubagentProfileRuntimeConfig>;
}

interface JsonMap {
  readonly [key: string]: unknown;
}

interface RuntimeConfigWithSubagents {
  readonly subagents?: OhmSubagentRuntimeConfig;
}

export const DEFAULT_OHM_SUBAGENT_RUNTIME_CONFIG: OhmSubagentRuntimeConfig = {
  taskMaxConcurrency: 3,
  taskRetentionMs: 1000 * 60 * 60 * 24,
  permissions: {
    default: "allow",
    subagents: {},
    allowInternalRouting: false,
  },
  profiles: {},
};

const SUBAGENT_RUNTIME_RESERVED_KEYS = new Set([
  "taskMaxConcurrency",
  "taskRetentionMs",
  "permissions",
  "profiles",
]);

const SUBAGENT_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

function isJsonMap(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return fallback;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number") return fallback;
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

function normalizePermissionDecision(value: unknown, fallback: "allow" | "deny"): "allow" | "deny" {
  if (value === "allow" || value === "deny") return value;

  // Legacy compatibility: treat deprecated "ask" as deny-safe behavior.
  if (value === "ask") return "deny";

  return fallback;
}

function normalizePermissionDecisionMap(
  value: unknown,
  fallback: Readonly<Record<string, "allow" | "deny">>,
): Record<string, "allow" | "deny"> {
  if (!isJsonMap(value)) {
    return { ...fallback };
  }

  const normalized: Record<string, "allow" | "deny"> = {};
  for (const [key, decision] of Object.entries(value)) {
    const trimmedKey = key.trim().toLowerCase();
    if (trimmedKey.length === 0) continue;

    const normalizedDecision = normalizePermissionDecision(decision, "allow");
    normalized[trimmedKey] = normalizedDecision;
  }

  return normalized;
}

function normalizeSubagentToolPermissionDecision(
  value: unknown,
): OhmSubagentToolPermissionDecision | undefined {
  if (value === "allow" || value === "deny" || value === "inherit") return value;

  // Legacy compatibility: treat deprecated "ask" as deny-safe behavior.
  if (value === "ask") return "deny";
  return undefined;
}

function normalizeSubagentToolPermissionDecisionPatch(
  value: SubagentToolPermissionDecisionPatch,
): OhmSubagentToolPermissionDecision {
  if (value === "allow" || value === "deny" || value === "inherit") return value;
  return "deny";
}

function normalizeSubagentToolPermissionMap(
  value: unknown,
  fallback: Readonly<Record<string, OhmSubagentToolPermissionDecision>>,
): Readonly<Record<string, OhmSubagentToolPermissionDecision>> {
  if (!isJsonMap(value)) return fallback;

  const normalized: Record<string, OhmSubagentToolPermissionDecision> = { ...fallback };
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
  if (!SUBAGENT_THINKING_LEVELS.has(suffix)) {
    return trimmed;
  }

  return trimmed.slice(0, colonIndex).trim();
}

function mergeSubagentVariantConfig(
  patch: JsonMap,
  fallback: OhmSubagentProfileVariantRuntimeConfig | undefined,
): OhmSubagentProfileVariantRuntimeConfig | undefined {
  const parsedPatch = parseSubagentProfileVariantPatch(patch);
  if (!parsedPatch) return fallback;

  const model = normalizeSubagentModelOverride(parsedPatch.model);
  const prompt = parsedPatch.prompt;
  const description = parsedPatch.description;
  const whenToUse = parsedPatch.whenToUse;
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

  const merged: OhmSubagentProfileVariantRuntimeConfig = {
    ...fallback,
    ...(model ? { model } : {}),
    ...(prompt ? { prompt } : {}),
    ...(description ? { description } : {}),
    ...(whenToUse ? { whenToUse } : {}),
    ...(Object.keys(permissions).length > 0 ? { permissions } : {}),
  };

  const hasValues =
    merged.model !== undefined ||
    merged.prompt !== undefined ||
    merged.description !== undefined ||
    merged.whenToUse !== undefined ||
    merged.permissions !== undefined;

  if (!hasValues) return undefined;
  return merged;
}

function normalizeSubagentVariantMap(
  value: unknown,
  fallback: Readonly<Record<string, OhmSubagentProfileVariantRuntimeConfig>>,
): Readonly<Record<string, OhmSubagentProfileVariantRuntimeConfig>> {
  if (!isJsonMap(value)) return fallback;

  const merged: Record<string, OhmSubagentProfileVariantRuntimeConfig> = { ...fallback };
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

function mergeSubagentProfileConfig(
  patch: JsonMap,
  fallback: OhmSubagentProfileRuntimeConfig | undefined,
): OhmSubagentProfileRuntimeConfig | undefined {
  const parsedPatch = parseSubagentProfilePatch(patch);
  if (!parsedPatch) return fallback;

  const model = normalizeSubagentModelOverride(parsedPatch.model);
  const prompt = parsedPatch.prompt;
  const description = parsedPatch.description;
  const whenToUse = parsedPatch.whenToUse;
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

  const merged: OhmSubagentProfileRuntimeConfig = {
    ...fallback,
    ...(model ? { model } : {}),
    ...(prompt ? { prompt } : {}),
    ...(description ? { description } : {}),
    ...(whenToUse ? { whenToUse } : {}),
    ...(Object.keys(permissions).length > 0 ? { permissions } : {}),
    ...(Object.keys(variants).length > 0 ? { variants } : {}),
  };

  const hasValues =
    merged.model !== undefined ||
    merged.prompt !== undefined ||
    merged.description !== undefined ||
    merged.whenToUse !== undefined ||
    merged.permissions !== undefined ||
    merged.variants !== undefined;

  if (!hasValues) return undefined;
  return merged;
}

function normalizeSubagentProfileMap(
  value: unknown,
  fallback: Record<string, OhmSubagentProfileRuntimeConfig>,
): Record<string, OhmSubagentProfileRuntimeConfig> {
  const normalized = structuredClone(fallback);
  if (!isJsonMap(value)) return normalized;

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim().toLowerCase();
    if (key.length === 0) continue;
    if (!isJsonMap(rawValue)) continue;

    const mergedProfile = mergeSubagentProfileConfig(rawValue, normalized[key]);
    if (!mergedProfile) continue;
    normalized[key] = mergedProfile;
  }

  return normalized;
}

function normalizeInlineSubagentProfiles(
  value: JsonMap | undefined,
  fallback: Record<string, OhmSubagentProfileRuntimeConfig>,
): Record<string, OhmSubagentProfileRuntimeConfig> {
  const normalized = structuredClone(fallback);
  if (!value) return normalized;

  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (SUBAGENT_RUNTIME_RESERVED_KEYS.has(rawKey)) continue;

    const key = rawKey.trim().toLowerCase();
    if (key.length === 0) continue;
    if (!isJsonMap(rawValue)) continue;

    const mergedProfile = mergeSubagentProfileConfig(rawValue, normalized[key]);
    if (!mergedProfile) continue;
    normalized[key] = mergedProfile;
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
  readonly current: OhmSubagentRuntimeConfig | undefined;
  readonly patch: unknown;
}): OhmSubagentRuntimeConfig {
  const patch = isJsonMap(input.patch) ? input.patch : undefined;
  const defaults = input.current ?? DEFAULT_OHM_SUBAGENT_RUNTIME_CONFIG;

  const taskMaxConcurrency = normalizePositiveInteger(
    patch?.taskMaxConcurrency,
    defaults.taskMaxConcurrency,
  );

  const taskRetentionMs = normalizePositiveInteger(
    patch?.taskRetentionMs,
    defaults.taskRetentionMs,
  );

  const permissionsPatch = isJsonMap(patch?.permissions) ? patch.permissions : undefined;

  const permissionsDefault = normalizePermissionDecision(
    permissionsPatch?.default,
    defaults.permissions.default,
  );

  const permissionsSubagents = normalizePermissionDecisionMap(
    permissionsPatch?.subagents,
    defaults.permissions.subagents,
  );

  const allowInternalRouting = normalizeBoolean(
    permissionsPatch?.allowInternalRouting,
    defaults.permissions.allowInternalRouting,
  );

  const explicitProfiles = normalizeSubagentProfileMap(
    isJsonMap(patch?.profiles) ? patch.profiles : undefined,
    defaults.profiles,
  );
  const profiles = normalizeInlineSubagentProfiles(patch, explicitProfiles);

  return {
    taskMaxConcurrency,
    taskRetentionMs,
    permissions: {
      default: permissionsDefault,
      subagents: permissionsSubagents,
      allowInternalRouting,
    },
    profiles,
  };
}

export function getSubagentConfiguredModel(
  config: RuntimeConfigWithSubagents,
  subagentId: string,
): string | undefined {
  const key = subagentId.trim().toLowerCase();
  if (key.length === 0) return undefined;
  return config.subagents?.profiles[key]?.model;
}

export function getSubagentProfileRuntimeConfig(
  config: RuntimeConfigWithSubagents,
  subagentId: string,
): OhmSubagentProfileRuntimeConfig | undefined {
  const key = subagentId.trim().toLowerCase();
  if (key.length === 0) return undefined;
  return config.subagents?.profiles[key];
}

export function resolveSubagentVariantPattern(input: {
  readonly variants: Readonly<Record<string, OhmSubagentProfileVariantRuntimeConfig>> | undefined;
  readonly modelPattern: string | undefined;
}): string | undefined {
  if (!input.variants) return undefined;

  const candidates = toModelVariantCandidates(input.modelPattern);
  if (candidates.length === 0) return undefined;

  for (const pattern of Object.keys(input.variants)) {
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
  readonly base: Readonly<Record<string, OhmSubagentToolPermissionDecision>> | undefined;
  readonly override: Readonly<Record<string, OhmSubagentToolPermissionDecision>> | undefined;
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

export function resolveSubagentProfileRuntimeConfig(input: {
  readonly config: RuntimeConfigWithSubagents;
  readonly subagentId: string;
  readonly modelPattern?: string;
}): ResolvedOhmSubagentProfileRuntimeConfig | undefined {
  const profile = getSubagentProfileRuntimeConfig(input.config, input.subagentId);
  if (!profile) return undefined;

  const variantPattern = resolveSubagentVariantPattern({
    variants: profile.variants,
    modelPattern: input.modelPattern ?? profile.model,
  });
  const variant = variantPattern ? profile.variants?.[variantPattern] : undefined;

  const permissions = applyInheritedToolPermissions({
    base: profile.permissions,
    override: variant?.permissions,
  });

  return {
    model: variant?.model ?? profile.model,
    prompt: variant?.prompt ?? profile.prompt,
    description: variant?.description ?? profile.description,
    whenToUse: variant?.whenToUse ?? profile.whenToUse,
    permissions,
    ...(variantPattern ? { variantPattern } : {}),
  };
}

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
};
