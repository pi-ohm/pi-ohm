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

export function resolveSubagentPromptProfile(
  input: SubagentSystemPromptInput,
): SubagentPromptProfile {
  const parsedPattern = parseModelPattern(input.modelPattern);
  const provider = normalizeToken(input.provider) || parsedPattern?.provider || "";
  const modelId = normalizeToken(input.modelId) || parsedPattern?.modelId || "";

  const providerOrModel = `${provider} ${modelId}`.trim();

  if (
    includesAny(provider, ["anthropic"]) ||
    includesAny(modelId, ["claude"]) ||
    includesAny(providerOrModel, ["claude"])
  ) {
    return "anthropic";
  }

  if (
    includesAny(provider, ["openai"]) ||
    includesAny(modelId, ["gpt", "o1", "o3", "o4"]) ||
    includesAny(providerOrModel, ["gpt"])
  ) {
    return "openai";
  }

  if (
    includesAny(provider, ["google", "gemini"]) ||
    includesAny(modelId, ["gemini"]) ||
    includesAny(providerOrModel, ["gemini"])
  ) {
    return "google";
  }

  if (
    includesAny(provider, ["moonshot", "moonshotai", "moonshot.ai"]) ||
    includesAny(modelId, ["kimi"]) ||
    includesAny(providerOrModel, ["kimi"])
  ) {
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
