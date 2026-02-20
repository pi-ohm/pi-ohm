export type SubagentPromptProfile = "anthropic" | "openai" | "google" | "moonshot" | "generic";

export interface SubagentSystemPromptInput {
  readonly provider?: string;
  readonly modelId?: string;
  readonly modelPattern?: string;
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

const DEFAULT_PROMPT_PROFILE_MATCHERS: PromptProfileMatchers = {
  anthropic: ["anthropic", "claude"],
  openai: ["openai", "gpt", "o1", "o3", "o4"],
  google: ["google", "gemini"],
  moonshot: ["moonshot", "moonshotai", "moonshot.ai", "kimi"],
};

const PROMPT_PROFILE_MATCHERS_ENV = "OHM_SUBAGENTS_PROMPT_PROFILE_MATCHERS_JSON";

function normalizeToken(value: string | undefined): string {
  if (!value) return "";
  return value.trim().toLowerCase();
}

function parseModelPattern(value: string | undefined): ParsedModelPattern | undefined {
  const normalized = normalizeToken(value);
  if (normalized.length === 0) return undefined;

  const slashIndex = normalized.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= normalized.length - 1) return undefined;

  const provider = normalized.slice(0, slashIndex);
  const modelWithThinking = normalized.slice(slashIndex + 1);
  const colonIndex = modelWithThinking.indexOf(":");
  const modelId =
    colonIndex === -1 ? modelWithThinking : modelWithThinking.slice(0, Math.max(colonIndex, 0));

  if (provider.length === 0 || modelId.length === 0) return undefined;
  return { provider, modelId };
}

function includesAny(input: string, needles: readonly string[]): boolean {
  for (const needle of needles) {
    if (input.includes(needle)) return true;
  }

  return false;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function sanitizeMatcherValues(value: readonly string[]): readonly string[] {
  const next: string[] = [];
  for (const entry of value) {
    const normalized = normalizeToken(entry);
    if (normalized.length === 0) continue;
    if (next.includes(normalized)) continue;
    next.push(normalized);
  }

  return next;
}

function parsePromptProfileMatchersOverrides(
  raw: string | undefined,
): Partial<PromptProfileMatchers> {
  if (!raw) return {};
  const trimmed = raw.trim();
  if (trimmed.length === 0) return {};

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isObjectRecord(parsed)) return {};

    const anthropic = isStringArray(parsed.anthropic)
      ? sanitizeMatcherValues(parsed.anthropic)
      : undefined;
    const openai = isStringArray(parsed.openai) ? sanitizeMatcherValues(parsed.openai) : undefined;
    const google = isStringArray(parsed.google) ? sanitizeMatcherValues(parsed.google) : undefined;
    const moonshot = isStringArray(parsed.moonshot)
      ? sanitizeMatcherValues(parsed.moonshot)
      : undefined;

    return {
      ...(anthropic ? { anthropic } : {}),
      ...(openai ? { openai } : {}),
      ...(google ? { google } : {}),
      ...(moonshot ? { moonshot } : {}),
    };
  } catch {
    return {};
  }
}

function resolvePromptProfileMatchers(): PromptProfileMatchers {
  const overrides = parsePromptProfileMatchersOverrides(process.env[PROMPT_PROFILE_MATCHERS_ENV]);
  return {
    anthropic: overrides.anthropic ?? DEFAULT_PROMPT_PROFILE_MATCHERS.anthropic,
    openai: overrides.openai ?? DEFAULT_PROMPT_PROFILE_MATCHERS.openai,
    google: overrides.google ?? DEFAULT_PROMPT_PROFILE_MATCHERS.google,
    moonshot: overrides.moonshot ?? DEFAULT_PROMPT_PROFILE_MATCHERS.moonshot,
  };
}

export function resolveSubagentPromptProfile(
  input: SubagentSystemPromptInput,
): SubagentPromptProfile {
  const matchers = resolvePromptProfileMatchers();
  const parsedPattern = parseModelPattern(input.modelPattern);
  const provider = normalizeToken(input.provider) || parsedPattern?.provider || "";
  const modelId = normalizeToken(input.modelId) || parsedPattern?.modelId || "";

  const providerOrModel = `${provider} ${modelId}`.trim();

  if (includesAny(providerOrModel, matchers.anthropic)) {
    return "anthropic";
  }

  if (includesAny(providerOrModel, matchers.openai)) {
    return "openai";
  }

  if (includesAny(providerOrModel, matchers.google)) {
    return "google";
  }

  if (includesAny(providerOrModel, matchers.moonshot)) {
    return "moonshot";
  }

  return "generic";
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
