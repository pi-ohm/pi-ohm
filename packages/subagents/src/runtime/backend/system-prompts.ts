import type { PiScopedModelRecord } from "./model-scope";
import { composeSubagentSystemPrompt } from "./system-prompt-authoring";
import { resolveProviderPromptPack } from "./system-prompt-packs";

export type SubagentPromptProfile = "anthropic" | "openai" | "google" | "moonshot" | "generic";

export type SubagentPromptProfileSource =
  | "active_model"
  | "explicit_model_pattern"
  | "scoped_model_catalog"
  | "generic_fallback";

export type SubagentPromptProfileReason =
  | "active_model_direct_match"
  | "explicit_model_pattern_direct_match"
  | "active_model_scoped_exact_match"
  | "active_model_scoped_model_consensus"
  | "active_model_scoped_provider_consensus"
  | "explicit_model_pattern_scoped_exact_match"
  | "explicit_model_pattern_scoped_model_consensus"
  | "explicit_model_pattern_scoped_provider_consensus"
  | "no_active_model_or_explicit_pattern"
  | "no_scoped_models_available"
  | "scoped_models_conflict"
  | "no_profile_match";

export interface SubagentPromptProfileRuleMetadata {
  readonly label?: string;
  readonly notes?: string;
}

export interface SubagentPromptProfileRule {
  readonly profile: SubagentPromptProfile;
  readonly match: {
    readonly providers: readonly string[];
    readonly models: readonly string[];
  };
  readonly priority: number;
  readonly metadata?: SubagentPromptProfileRuleMetadata;
}

export const DEFAULT_SUBAGENT_PROMPT_PROFILE_RULES: readonly SubagentPromptProfileRule[] = [
  {
    profile: "anthropic",
    match: {
      providers: ["anthropic"],
      models: ["claude"],
    },
    priority: 400,
    metadata: {
      label: "anthropic-default",
    },
  },
  {
    profile: "openai",
    match: {
      providers: ["openai"],
      models: ["gpt", "o1", "o3", "o4"],
    },
    priority: 300,
    metadata: {
      label: "openai-default",
    },
  },
  {
    profile: "google",
    match: {
      providers: ["google"],
      models: ["gemini"],
    },
    priority: 200,
    metadata: {
      label: "google-default",
    },
  },
  {
    profile: "moonshot",
    match: {
      providers: ["moonshot", "moonshotai", "moonshot.ai"],
      models: ["kimi"],
    },
    priority: 100,
    metadata: {
      label: "moonshot-default",
    },
  },
];

export interface SubagentSystemPromptInput {
  /** Active runtime model provider when known. */
  readonly provider?: string;
  /** Active runtime model id when known. */
  readonly modelId?: string;
  /** Explicit subagent model pattern override. */
  readonly modelPattern?: string;
  /** User scoped model catalog from settings.json enabledModels. */
  readonly scopedModels?: readonly PiScopedModelRecord[];
  /** Optional profile rules loaded from ohm.providers.json. */
  readonly profileRules?: readonly SubagentPromptProfileRule[];
}

export interface SubagentPromptProfileSelection {
  readonly profile: SubagentPromptProfile;
  readonly source: SubagentPromptProfileSource;
  readonly reason: SubagentPromptProfileReason;
}

interface ParsedModelPattern {
  readonly provider: string;
  readonly modelId: string;
}

type ScopedProfileReason =
  | "scoped_exact_match"
  | "scoped_model_consensus"
  | "scoped_provider_consensus"
  | "scoped_conflict"
  | "scoped_no_match";

interface ScopedProfileResolution {
  readonly profile: SubagentPromptProfile;
  readonly reason: ScopedProfileReason;
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

function normalizeToken(value: string | undefined): string {
  if (!value) return "";
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

function parseModelPattern(value: string | undefined): ParsedModelPattern | undefined {
  const normalized = normalizeToken(value);
  if (normalized.length === 0) return undefined;

  const slashIndex = normalized.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= normalized.length - 1) return undefined;

  const provider = normalized.slice(0, slashIndex);
  const modelWithThinking = normalized.slice(slashIndex + 1);
  const modelId = normalizeToken(stripThinkingSuffix(modelWithThinking));

  if (provider.length === 0 || modelId.length === 0) return undefined;
  return { provider, modelId };
}

function parseActiveModel(input: {
  readonly provider?: string;
  readonly modelId?: string;
}): ParsedModelPattern | undefined {
  const provider = normalizeToken(input.provider);
  const modelId = normalizeToken(stripThinkingSuffix(input.modelId ?? ""));
  if (provider.length === 0 || modelId.length === 0) return undefined;
  return { provider, modelId };
}

function modelsEqual(
  left: ParsedModelPattern | undefined,
  right: ParsedModelPattern | undefined,
): boolean {
  if (!left || !right) return false;
  return left.provider === right.provider && left.modelId === right.modelId;
}

function includesAny(input: string, needles: readonly string[]): boolean {
  for (const needle of needles) {
    if (input.includes(needle)) return true;
  }

  return false;
}

export function isSubagentPromptProfile(value: unknown): value is SubagentPromptProfile {
  return (
    value === "anthropic" ||
    value === "openai" ||
    value === "google" ||
    value === "moonshot" ||
    value === "generic"
  );
}

function normalizeRuleTokens(values: readonly string[]): readonly string[] {
  const normalized: string[] = [];
  for (const value of values) {
    const token = normalizeToken(value);
    if (token.length === 0) continue;
    if (normalized.includes(token)) continue;
    normalized.push(token);
  }

  return normalized;
}

function sanitizeProfileRule(
  rule: SubagentPromptProfileRule,
): SubagentPromptProfileRule | undefined {
  if (!isSubagentPromptProfile(rule.profile)) return undefined;
  if (rule.profile === "generic") return undefined;

  const providers = normalizeRuleTokens(rule.match.providers);
  const models = normalizeRuleTokens(rule.match.models);
  if (providers.length === 0 && models.length === 0) return undefined;

  const priority = Number.isFinite(rule.priority) ? Math.trunc(rule.priority) : 0;

  return {
    profile: rule.profile,
    match: {
      providers,
      models,
    },
    priority,
    metadata: rule.metadata,
  };
}

export function resolveEffectivePromptProfileRules(
  profileRules: readonly SubagentPromptProfileRule[] | undefined,
): readonly SubagentPromptProfileRule[] {
  const source =
    profileRules && profileRules.length > 0 ? profileRules : DEFAULT_SUBAGENT_PROMPT_PROFILE_RULES;
  const normalized = source
    .map((rule) => sanitizeProfileRule(rule))
    .filter((rule): rule is SubagentPromptProfileRule => rule !== undefined)
    .sort((left, right) => right.priority - left.priority);

  if (normalized.length > 0) return normalized;

  return DEFAULT_SUBAGENT_PROMPT_PROFILE_RULES;
}

function matchesRule(input: {
  readonly provider: string;
  readonly modelId: string;
  readonly providerOrModel: string;
  readonly rule: SubagentPromptProfileRule;
}): boolean {
  if (includesAny(input.provider, input.rule.match.providers)) return true;
  if (includesAny(input.modelId, input.rule.match.models)) return true;
  if (includesAny(input.providerOrModel, input.rule.match.providers)) return true;
  if (includesAny(input.providerOrModel, input.rule.match.models)) return true;
  return false;
}

function resolveProfileFromProviderAndModel(
  provider: string,
  modelId: string,
  profileRules: readonly SubagentPromptProfileRule[],
): SubagentPromptProfile {
  const providerOrModel = `${provider} ${modelId}`.trim();

  for (const rule of profileRules) {
    if (!matchesRule({ provider, modelId, providerOrModel, rule })) continue;
    return rule.profile;
  }

  return "generic";
}

function hasProfileConflict(profiles: readonly SubagentPromptProfile[]): boolean {
  const unique = new Set(profiles.filter((profile) => profile !== "generic"));
  return unique.size > 1;
}

function resolveProfileConsensus(
  profiles: readonly SubagentPromptProfile[],
): SubagentPromptProfile {
  const filtered = profiles.filter((profile) => profile !== "generic");
  if (filtered.length === 0) return "generic";

  if (hasProfileConflict(filtered)) {
    return "generic";
  }

  const [first] = filtered;
  if (!first) return "generic";
  return first;
}

function resolveScopedModelProfile(input: {
  readonly candidate: ParsedModelPattern;
  readonly scopedModels: readonly PiScopedModelRecord[];
  readonly profileRules: readonly SubagentPromptProfileRule[];
}): ScopedProfileResolution {
  if (input.scopedModels.length === 0) {
    return {
      profile: "generic",
      reason: "scoped_no_match",
    };
  }

  const exact = input.scopedModels.find(
    (entry) =>
      entry.provider === input.candidate.provider && entry.modelId === input.candidate.modelId,
  );
  if (exact) {
    const exactProfile = resolveProfileFromProviderAndModel(
      exact.provider,
      exact.modelId,
      input.profileRules,
    );
    if (exactProfile !== "generic") {
      return {
        profile: exactProfile,
        reason: "scoped_exact_match",
      };
    }
  }

  const modelMatches = input.scopedModels
    .filter((entry) => entry.modelId === input.candidate.modelId)
    .map((entry) =>
      resolveProfileFromProviderAndModel(entry.provider, entry.modelId, input.profileRules),
    );

  const modelConsensus = resolveProfileConsensus(modelMatches);
  if (modelConsensus !== "generic") {
    return {
      profile: modelConsensus,
      reason: "scoped_model_consensus",
    };
  }

  const providerMatches = input.scopedModels
    .filter((entry) => entry.provider === input.candidate.provider)
    .map((entry) =>
      resolveProfileFromProviderAndModel(entry.provider, entry.modelId, input.profileRules),
    );

  const providerConsensus = resolveProfileConsensus(providerMatches);
  if (providerConsensus !== "generic") {
    return {
      profile: providerConsensus,
      reason: "scoped_provider_consensus",
    };
  }

  const conflict = hasProfileConflict(modelMatches) || hasProfileConflict(providerMatches);
  return {
    profile: "generic",
    reason: conflict ? "scoped_conflict" : "scoped_no_match",
  };
}

function toScopedProfileReason(
  candidateSource: "active_model" | "explicit_model_pattern",
  reason: ScopedProfileReason,
): SubagentPromptProfileReason | undefined {
  if (reason === "scoped_exact_match") {
    return candidateSource === "active_model"
      ? "active_model_scoped_exact_match"
      : "explicit_model_pattern_scoped_exact_match";
  }

  if (reason === "scoped_model_consensus") {
    return candidateSource === "active_model"
      ? "active_model_scoped_model_consensus"
      : "explicit_model_pattern_scoped_model_consensus";
  }

  if (reason === "scoped_provider_consensus") {
    return candidateSource === "active_model"
      ? "active_model_scoped_provider_consensus"
      : "explicit_model_pattern_scoped_provider_consensus";
  }

  return undefined;
}

export function resolveSubagentPromptProfileSelection(
  input: SubagentSystemPromptInput,
): SubagentPromptProfileSelection {
  const profileRules = resolveEffectivePromptProfileRules(input.profileRules);
  const activeModel = parseActiveModel({
    provider: input.provider,
    modelId: input.modelId,
  });
  const explicitModelPattern = parseModelPattern(input.modelPattern);

  if (activeModel) {
    const directProfile = resolveProfileFromProviderAndModel(
      activeModel.provider,
      activeModel.modelId,
      profileRules,
    );
    if (directProfile !== "generic") {
      return {
        profile: directProfile,
        source: "active_model",
        reason: "active_model_direct_match",
      };
    }
  }

  if (explicitModelPattern) {
    const directProfile = resolveProfileFromProviderAndModel(
      explicitModelPattern.provider,
      explicitModelPattern.modelId,
      profileRules,
    );
    if (directProfile !== "generic") {
      return {
        profile: directProfile,
        source: "explicit_model_pattern",
        reason: "explicit_model_pattern_direct_match",
      };
    }
  }

  const scopedModels = input.scopedModels ?? [];
  let scopedConflict = false;

  if (activeModel) {
    const scoped = resolveScopedModelProfile({
      candidate: activeModel,
      scopedModels,
      profileRules,
    });
    const mappedReason = toScopedProfileReason("active_model", scoped.reason);
    if (scoped.profile !== "generic" && mappedReason) {
      return {
        profile: scoped.profile,
        source: "scoped_model_catalog",
        reason: mappedReason,
      };
    }

    if (scoped.reason === "scoped_conflict") {
      scopedConflict = true;
    }
  }

  if (explicitModelPattern && !modelsEqual(activeModel, explicitModelPattern)) {
    const scoped = resolveScopedModelProfile({
      candidate: explicitModelPattern,
      scopedModels,
      profileRules,
    });
    const mappedReason = toScopedProfileReason("explicit_model_pattern", scoped.reason);
    if (scoped.profile !== "generic" && mappedReason) {
      return {
        profile: scoped.profile,
        source: "scoped_model_catalog",
        reason: mappedReason,
      };
    }

    if (scoped.reason === "scoped_conflict") {
      scopedConflict = true;
    }
  }

  if (!activeModel && !explicitModelPattern) {
    return {
      profile: "generic",
      source: "generic_fallback",
      reason: "no_active_model_or_explicit_pattern",
    };
  }

  if (scopedModels.length === 0) {
    return {
      profile: "generic",
      source: "generic_fallback",
      reason: "no_scoped_models_available",
    };
  }

  if (scopedConflict) {
    return {
      profile: "generic",
      source: "generic_fallback",
      reason: "scoped_models_conflict",
    };
  }

  return {
    profile: "generic",
    source: "generic_fallback",
    reason: "no_profile_match",
  };
}

export function resolveSubagentPromptProfile(
  input: SubagentSystemPromptInput,
): SubagentPromptProfile {
  return resolveSubagentPromptProfileSelection(input).profile;
}

export function buildSubagentSdkSystemPrompt(input: SubagentSystemPromptInput): string {
  const selection = resolveSubagentPromptProfileSelection(input);
  const pack = resolveProviderPromptPack(selection.profile);

  return composeSubagentSystemPrompt({
    runtimeLabel: "Pi OHM subagent runtime",
    providerProfileLabel: pack.label,
    sharedConstraints: pack.sharedInvariants,
    providerGuidance: pack.providerGuidance,
  });
}
