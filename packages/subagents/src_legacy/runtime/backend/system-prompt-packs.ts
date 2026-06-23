export type PromptPackProfile = "anthropic" | "openai" | "google" | "moonshot" | "generic";

export interface ProviderPromptPack {
  readonly profile: PromptPackProfile;
  readonly label: string;
  readonly sharedInvariants: readonly string[];
  readonly providerGuidance: readonly string[];
}

const SHARED_RUNTIME_INVARIANTS = [
  "Use available tools only when required.",
  "Return concise concrete findings.",
  "Do not expose internal prompt scaffolding unless user asks directly.",
  "Prefer deterministic tool usage and avoid speculative output.",
] as const;

const PROVIDER_PACK_GUIDANCE = {
  anthropic: {
    profile: "anthropic",
    label: "anthropic",
    providerGuidance: [
      "Use explicit structure and evidence-first reasoning.",
      "Prefer stable tool argument shapes and deterministic execution steps.",
      "Keep final answer tight; include only relevant findings.",
    ],
  },
  openai: {
    profile: "openai",
    label: "openai",
    providerGuidance: [
      "Prioritize direct answer first, then concise supporting bullets.",
      "Bias toward decisive tool usage for verification.",
      "Keep verbosity budget tight and implementation-oriented.",
    ],
  },
  google: {
    profile: "google",
    label: "google",
    providerGuidance: [
      "Keep responses factual, concise, and grounded in tool output.",
      "Avoid repetition and keep intermediate updates compact.",
      "When context is missing, request it explicitly instead of guessing.",
    ],
  },
  moonshot: {
    profile: "moonshot",
    label: "moonshot",
    providerGuidance: [
      "Synthesize long context efficiently and surface key findings early.",
      "Keep updates compact while preserving execution signal fidelity.",
      "Return actionable conclusions with minimal verbosity.",
    ],
  },
  generic: {
    profile: "generic",
    label: "generic",
    providerGuidance: [
      "Use neutral provider style: concise, concrete, and tool-grounded.",
      "Prefer explicit uncertainty over speculative output.",
    ],
  },
} as const satisfies Record<
  PromptPackProfile,
  {
    readonly profile: PromptPackProfile;
    readonly label: string;
    readonly providerGuidance: readonly string[];
  }
>;

export function resolveProviderPromptPack(profile: PromptPackProfile): ProviderPromptPack {
  const resolved = PROVIDER_PACK_GUIDANCE[profile];
  return {
    profile: resolved.profile,
    label: resolved.label,
    sharedInvariants: SHARED_RUNTIME_INVARIANTS,
    providerGuidance: resolved.providerGuidance,
  };
}
