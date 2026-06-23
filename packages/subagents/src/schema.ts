import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

const UnknownObjectSchema = Type.Unsafe<Readonly<Record<string, unknown>>>({
  type: "object",
  additionalProperties: true,
});

export const SubagentToolPermissionDecisionSchema = Type.Union(
  [Type.Literal("allow"), Type.Literal("deny")],
  { description: "Tool permission decision for a subagent." },
);

export const SubagentToolPermissionMapSchema = Type.Record(
  Type.String({ description: "Tool name.", minLength: 1 }),
  SubagentToolPermissionDecisionSchema,
  { description: "Per-tool subagent permission overrides." },
);

export const SubagentAgentPatchSchema = Type.Object(
  {
    disabled: Type.Optional(
      Type.Boolean({
        default: false,
        description: "Hide this subagent from model-facing availability.",
      }),
    ),
    model: Type.Optional(
      Type.String({
        description: "Subagent model override as provider/model with optional thinking suffix.",
        minLength: 1,
      }),
    ),
    tools: Type.Optional(
      Type.Array(Type.String({ description: "Allowed tool name.", minLength: 1 }), {
        description: "Allowed tool names for this subagent.",
        minItems: 1,
      }),
    ),
    maxTurns: Type.Optional(
      Type.Integer({
        description: "Maximum model turns the subagent may take.",
        minimum: 1,
      }),
    ),
    prompt: Type.Optional(
      Type.String({ description: "System prompt used by this subagent.", minLength: 1 }),
    ),
    description: Type.Optional(
      Type.String({
        description: "Model-facing guidance for when to use this subagent.",
        minLength: 1,
      }),
    ),
    permissions: Type.Optional(SubagentToolPermissionMapSchema),
  },
  {
    additionalProperties: false,
    description: "Inline subagent config.",
  },
);

export const SummarizeHistoryTypeSchema = Type.Union(
  [Type.Literal("branch"), Type.Literal("compact")],
  {
    default: "branch",
    description: "Strategy used to summarize forked parent history.",
  },
);

export const SummarizeHistoryConfigPatchSchema = Type.Object(
  {
    enabled: Type.Optional(
      Type.Boolean({
        default: false,
        description:
          "Summarize inherited parent history when spawning subagents with forked context.",
      }),
    ),
    type: Type.Optional(SummarizeHistoryTypeSchema),
    model: Type.Optional(
      Type.String({
        description: "Accepted for compatibility; runtime uses the active main session model.",
        minLength: 1,
      }),
    ),
  },
  {
    additionalProperties: false,
    description: "Experimental subagent fork-history summarization config.",
  },
);

export const SubagentsExperimentalConfigPatchSchema = Type.Object(
  {
    summarize_history: Type.Optional(SummarizeHistoryConfigPatchSchema),
  },
  {
    additionalProperties: false,
    description: "Experimental subagents config.",
  },
);

export interface SummarizeHistoryConfigPatch {
  readonly enabled?: boolean;
  readonly type?: SummarizeHistoryType;
  readonly model?: string;
}

export interface SubagentsExperimentalConfigPatch {
  readonly summarize_history?: SummarizeHistoryConfigPatch;
}

export interface SubagentsConfigPatch {
  readonly experimental?: SubagentsExperimentalConfigPatch;
  readonly [agentId: string]: SubagentAgentPatch | SubagentsExperimentalConfigPatch | undefined;
}

export const SubagentsConfigSchema = Type.Unsafe<SubagentsConfigPatch>({
  type: "object",
  properties: {
    experimental: SubagentsExperimentalConfigPatchSchema,
  },
  additionalProperties: SubagentAgentPatchSchema,
  description: "Pi-ohm subagents config keyed by subagent name.",
});

export type SubagentToolPermissionDecisionPatch = Static<
  typeof SubagentToolPermissionDecisionSchema
>;
export type SummarizeHistoryType = Static<typeof SummarizeHistoryTypeSchema>;
export type SubagentAgentPatch = Static<typeof SubagentAgentPatchSchema>;

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function toTrimmedStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const normalized = value
    .map((entry) => toTrimmedString(entry))
    .filter((entry): entry is string => entry !== undefined);
  if (normalized.length === 0) return undefined;
  return normalized;
}

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function toSummarizeHistoryType(value: unknown): SummarizeHistoryType | undefined {
  const type = toTrimmedString(value)?.toLowerCase();
  if (type === "branch" || type === "compact") return type;
  return undefined;
}

function normalizeSubagentPermissionMapInput(
  value: unknown,
): Static<typeof SubagentToolPermissionMapSchema> | undefined {
  if (!Value.Check(UnknownObjectSchema, value)) return undefined;

  const normalized: Record<string, SubagentToolPermissionDecisionPatch> = {};
  for (const [rawToolName, rawDecision] of Object.entries(value)) {
    const toolName = toTrimmedString(rawToolName)?.toLowerCase();
    if (!toolName) continue;
    if (typeof rawDecision !== "string") continue;

    const decision = rawDecision.trim().toLowerCase();
    if (decision !== "allow" && decision !== "deny") continue;

    normalized[toolName] = decision;
  }

  if (!Value.Check(SubagentToolPermissionMapSchema, normalized)) {
    return undefined;
  }

  return Value.Decode(SubagentToolPermissionMapSchema, normalized);
}

function normalizeSubagentAgentPatchInput(input: unknown): unknown {
  if (!Value.Check(UnknownObjectSchema, input)) return input;

  const model = toTrimmedString(Reflect.get(input, "model"));
  const disabled = toBoolean(Reflect.get(input, "disabled"));
  const tools = toTrimmedStringArray(Reflect.get(input, "tools"));
  const maxTurns = toPositiveInteger(Reflect.get(input, "maxTurns"));
  const prompt = toTrimmedString(Reflect.get(input, "prompt"));
  const description = toTrimmedString(Reflect.get(input, "description"));
  const permissions = normalizeSubagentPermissionMapInput(Reflect.get(input, "permissions"));

  return {
    ...(disabled !== undefined ? { disabled } : {}),
    ...(model ? { model } : {}),
    ...(tools ? { tools } : {}),
    ...(maxTurns ? { maxTurns } : {}),
    ...(prompt ? { prompt } : {}),
    ...(description ? { description } : {}),
    ...(permissions ? { permissions } : {}),
  };
}

export function parseSubagentAgentPatch(input: unknown): SubagentAgentPatch | undefined {
  const normalized = normalizeSubagentAgentPatchInput(input);
  if (!Value.Check(SubagentAgentPatchSchema, normalized)) {
    return undefined;
  }

  return Value.Decode(SubagentAgentPatchSchema, normalized);
}

function normalizeSummarizeHistoryConfigPatchInput(input: unknown): unknown {
  if (!Value.Check(UnknownObjectSchema, input)) return input;

  const enabled = toBoolean(Reflect.get(input, "enabled"));
  const type = toSummarizeHistoryType(Reflect.get(input, "type"));
  const model = toTrimmedString(Reflect.get(input, "model"));

  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(type ? { type } : {}),
    ...(model ? { model } : {}),
  };
}

export function parseSummarizeHistoryConfigPatch(
  input: unknown,
): SummarizeHistoryConfigPatch | undefined {
  const normalized = normalizeSummarizeHistoryConfigPatchInput(input);
  if (!Value.Check(SummarizeHistoryConfigPatchSchema, normalized)) {
    return undefined;
  }

  return Value.Decode(SummarizeHistoryConfigPatchSchema, normalized);
}

function normalizeSubagentsExperimentalConfigPatchInput(input: unknown): unknown {
  if (!Value.Check(UnknownObjectSchema, input)) return input;

  const summarize = parseSummarizeHistoryConfigPatch(Reflect.get(input, "summarize_history"));

  if (!summarize) return {};
  return { summarize_history: summarize };
}

export function parseSubagentsExperimentalConfigPatch(
  input: unknown,
): SubagentsExperimentalConfigPatch | undefined {
  const normalized = normalizeSubagentsExperimentalConfigPatchInput(input);
  if (!Value.Check(SubagentsExperimentalConfigPatchSchema, normalized)) {
    return undefined;
  }

  return Value.Decode(SubagentsExperimentalConfigPatchSchema, normalized);
}
