import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

const NonEmptyStringSchema = Type.String({ minLength: 1 });
const NonEmptyStringArraySchema = Type.Array(NonEmptyStringSchema, { minItems: 1 });
const UnknownRecordSchema = Type.Record(Type.String(), Type.Unknown());

export const SubagentToolPermissionDecisionSchema = Type.Union([
  Type.Literal("allow"),
  Type.Literal("deny"),
]);

export const SubagentToolPermissionMapSchema = Type.Record(
  NonEmptyStringSchema,
  SubagentToolPermissionDecisionSchema,
);

export const SubagentAgentPatchSchema = Type.Object(
  {
    disabled: Type.Optional(Type.Boolean()),
    model: Type.Optional(NonEmptyStringSchema),
    tools: Type.Optional(NonEmptyStringArraySchema),
    maxTurns: Type.Optional(Type.Integer({ minimum: 1 })),
    prompt: Type.Optional(NonEmptyStringSchema),
    description: Type.Optional(NonEmptyStringSchema),
    permissions: Type.Optional(SubagentToolPermissionMapSchema),
  },
  { additionalProperties: false },
);

export const SummarizeHistoryTypeSchema = Type.Union([
  Type.Literal("compact"),
  Type.Literal("summary"),
]);

export const SummarizeHistoryConfigPatchSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    type: Type.Optional(SummarizeHistoryTypeSchema),
    model: Type.Optional(NonEmptyStringSchema),
  },
  { additionalProperties: false },
);

export const SubagentsExperimentalConfigPatchSchema = Type.Object(
  {
    summarize_history: Type.Optional(SummarizeHistoryConfigPatchSchema),
  },
  { additionalProperties: false },
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
  if (type === "compact" || type === "summary") return type;
  return undefined;
}

function normalizeSubagentPermissionMapInput(
  value: unknown,
): Static<typeof SubagentToolPermissionMapSchema> | undefined {
  if (!Value.Check(UnknownRecordSchema, value)) return undefined;

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
  if (!Value.Check(UnknownRecordSchema, input)) return input;

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
  if (!Value.Check(UnknownRecordSchema, input)) return input;

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
  if (!Value.Check(UnknownRecordSchema, input)) return input;

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
