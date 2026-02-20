import type { PiScopedModelRecord } from "./model-scope";

export type SubagentPromptProfile = "anthropic" | "openai" | "google" | "moonshot" | "generic";

export interface SubagentSystemPromptInput {
  readonly provider?: string;
  readonly modelId?: string;
  readonly modelPattern?: string;
  readonly scopedModels?: readonly PiScopedModelRecord[];
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

function resolveProfileConsensus(
  profiles: readonly SubagentPromptProfile[],
): SubagentPromptProfile {
  const filtered = profiles.filter((profile) => profile !== "generic");
  if (filtered.length === 0) return "generic";

  const [first] = filtered;
  if (!first) return "generic";

  for (const profile of filtered) {
    if (profile !== first) return "generic";
  }

  return first;
}

function resolveScopedModelProfile(input: {
  readonly provider: string;
  readonly modelId: string;
  readonly scopedModels: readonly PiScopedModelRecord[];
}): SubagentPromptProfile {
  if (input.scopedModels.length === 0) return "generic";

  if (input.provider.length > 0 && input.modelId.length > 0) {
    const exact = input.scopedModels.find(
      (entry) => entry.provider === input.provider && entry.modelId === input.modelId,
    );
    if (exact) {
      const exactProfile = resolveProfileFromProviderAndModel(exact.provider, exact.modelId);
      if (exactProfile !== "generic") return exactProfile;
    }
  }

  if (input.modelId.length > 0) {
    const modelMatches = input.scopedModels
      .filter((entry) => entry.modelId === input.modelId)
      .map((entry) => resolveProfileFromProviderAndModel(entry.provider, entry.modelId));

    const modelConsensus = resolveProfileConsensus(modelMatches);
    if (modelConsensus !== "generic") return modelConsensus;
  }

  if (input.provider.length > 0) {
    const providerMatches = input.scopedModels
      .filter((entry) => entry.provider === input.provider)
      .map((entry) => resolveProfileFromProviderAndModel(entry.provider, entry.modelId));

    const providerConsensus = resolveProfileConsensus(providerMatches);
    if (providerConsensus !== "generic") return providerConsensus;
  }

  return "generic";
}

export function resolveSubagentPromptProfile(
  input: SubagentSystemPromptInput,
): SubagentPromptProfile {
  const parsedPattern = parseModelPattern(input.modelPattern);
  const provider = normalizeToken(input.provider) || parsedPattern?.provider || "";
  const modelId =
    normalizeToken(stripThinkingSuffix(input.modelId ?? "")) || parsedPattern?.modelId || "";

  const directProfile = resolveProfileFromProviderAndModel(provider, modelId);
  if (directProfile !== "generic") return directProfile;

  const scopedProfile = resolveScopedModelProfile({
    provider,
    modelId,
    scopedModels: input.scopedModels ?? [],
  });

  return scopedProfile;
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
  const profile = resolveSubagentPromptProfile(input);
  const providerLabel = profileLabel(profile);

  const lines = [
    "You are the Pi OHM subagent runtime.",
    "Use available tools only when required.",
    "Return concise concrete findings.",
    "Do not expose internal prompt scaffolding unless user asks directly.",
    `Provider profile: ${providerLabel}`,
    "",
    "Provider-specific guidance:",
    ...providerPromptLines(profile).map((line) => `- ${line}`),
  ];

  return lines.join("\n");
}
