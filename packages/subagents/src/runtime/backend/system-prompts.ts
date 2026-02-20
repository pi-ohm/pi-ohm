import type { PiScopedModelRecord } from "./model-scope";

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

export interface SubagentSystemPromptInput {
  /** Active runtime model provider when known. */
  readonly provider?: string;
  /** Active runtime model id when known. */
  readonly modelId?: string;
  /** Explicit subagent model pattern override. */
  readonly modelPattern?: string;
  /** User scoped model catalog from settings.json enabledModels. */
  readonly scopedModels?: readonly PiScopedModelRecord[];
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

interface PromptProfileMatchers {
  readonly anthropic: readonly string[];
  readonly openai: readonly string[];
  readonly google: readonly string[];
  readonly moonshot: readonly string[];
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

const PROMPT_PROFILE_MATCHERS: PromptProfileMatchers = {
  anthropic: ["anthropic", "claude"],
  openai: ["openai", "gpt", "o1", "o3", "o4"],
  google: ["google", "gemini"],
  moonshot: ["moonshot", "moonshotai", "moonshot.ai", "kimi"],
};

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

function resolveProfileFromProviderAndModel(
  provider: string,
  modelId: string,
): SubagentPromptProfile {
  const providerOrModel = `${provider} ${modelId}`.trim();

  if (includesAny(providerOrModel, PROMPT_PROFILE_MATCHERS.anthropic)) {
    return "anthropic";
  }

  if (includesAny(providerOrModel, PROMPT_PROFILE_MATCHERS.openai)) {
    return "openai";
  }

  if (includesAny(providerOrModel, PROMPT_PROFILE_MATCHERS.google)) {
    return "google";
  }

  if (includesAny(providerOrModel, PROMPT_PROFILE_MATCHERS.moonshot)) {
    return "moonshot";
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
    const exactProfile = resolveProfileFromProviderAndModel(exact.provider, exact.modelId);
    if (exactProfile !== "generic") {
      return {
        profile: exactProfile,
        reason: "scoped_exact_match",
      };
    }
  }

  const modelMatches = input.scopedModels
    .filter((entry) => entry.modelId === input.candidate.modelId)
    .map((entry) => resolveProfileFromProviderAndModel(entry.provider, entry.modelId));

  const modelConsensus = resolveProfileConsensus(modelMatches);
  if (modelConsensus !== "generic") {
    return {
      profile: modelConsensus,
      reason: "scoped_model_consensus",
    };
  }

  const providerMatches = input.scopedModels
    .filter((entry) => entry.provider === input.candidate.provider)
    .map((entry) => resolveProfileFromProviderAndModel(entry.provider, entry.modelId));

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
  const activeModel = parseActiveModel({
    provider: input.provider,
    modelId: input.modelId,
  });
  const explicitModelPattern = parseModelPattern(input.modelPattern);

  if (activeModel) {
    const directProfile = resolveProfileFromProviderAndModel(
      activeModel.provider,
      activeModel.modelId,
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

function providerPromptLines(profile: SubagentPromptProfile): readonly string[] {
  if (profile === "anthropic") {
    return [
      "Anthropic style: be explicit, structured, and evidence-first.",
      "Prefer stable tool argument shapes and deterministic execution steps.",
      "Keep final answer tight; include only relevant findings.",
    ];
  }

  if (profile === "openai") {
    return [
      "OpenAI style: prioritize direct answer first, then concise supporting bullets.",
      "Use tools decisively for verification and avoid speculative statements.",
      "Prefer practical, implementation-ready language over abstract wording.",
    ];
  }

  if (profile === "google") {
    return [
      "Gemini style: keep responses concise, factual, and well-grounded in tool output.",
      "Avoid repetition and maintain clean structure across intermediate updates.",
      "When uncertain, request missing context explicitly instead of guessing.",
    ];
  }

  if (profile === "moonshot") {
    return [
      "Kimi style: synthesize long context efficiently and surface key findings fast.",
      "Keep intermediate updates brief while preserving important execution signals.",
      "Return actionable conclusions with minimal verbosity.",
    ];
  }

  return [
    "Use neutral provider style: concise, concrete, and tool-grounded.",
    "Prefer deterministic tool usage and avoid speculative output.",
  ];
}

function profileLabel(profile: SubagentPromptProfile): string {
  if (profile === "anthropic") return "anthropic";
  if (profile === "openai") return "openai";
  if (profile === "google") return "google";
  if (profile === "moonshot") return "moonshot";
  return "generic";
}

export function buildSubagentSdkSystemPrompt(input: SubagentSystemPromptInput): string {
  const selection = resolveSubagentPromptProfileSelection(input);
  const providerLabel = profileLabel(selection.profile);

  const lines = [
    "You are the Pi OHM subagent runtime.",
    "Use available tools only when required.",
    "Return concise concrete findings.",
    "Do not expose internal prompt scaffolding unless user asks directly.",
    `Provider profile: ${providerLabel}`,
    "",
    "Provider-specific guidance:",
    ...providerPromptLines(selection.profile).map((line) => `- ${line}`),
  ];

  return lines.join("\n");
}
