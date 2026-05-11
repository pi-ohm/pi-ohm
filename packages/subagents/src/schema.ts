import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

const NonEmptyStringSchema = Type.String({ minLength: 1 });
const NonEmptyStringArraySchema = Type.Array(NonEmptyStringSchema, { minItems: 1 });

export const SubagentToolPermissionDecisionSchema = Type.Union([
  Type.Literal("allow"),
  Type.Literal("deny"),
]);

export const SubagentVariantToolPermissionDecisionSchema = Type.Union([
  Type.Literal("allow"),
  Type.Literal("deny"),
  Type.Literal("inherit"),
]);

export const SubagentToolPermissionMapSchema = Type.Record(
  NonEmptyStringSchema,
  SubagentToolPermissionDecisionSchema,
);

export const SubagentVariantToolPermissionMapSchema = Type.Record(
  NonEmptyStringSchema,
  SubagentVariantToolPermissionDecisionSchema,
);

export const SubagentAgentVariantPatchSchema = Type.Object(
  {
    disabled: Type.Optional(Type.Boolean()),
    model: Type.Optional(NonEmptyStringSchema),
    tools: Type.Optional(NonEmptyStringArraySchema),
    maxTurns: Type.Optional(Type.Integer({ minimum: 1 })),
    prompt: Type.Optional(NonEmptyStringSchema),
    description: Type.Optional(NonEmptyStringSchema),
    permissions: Type.Optional(SubagentVariantToolPermissionMapSchema),
  },
  { additionalProperties: false },
);

export const SubagentAgentVariantMapPatchSchema = Type.Record(
  NonEmptyStringSchema,
  SubagentAgentVariantPatchSchema,
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
    variants: Type.Optional(SubagentAgentVariantMapPatchSchema),
  },
  { additionalProperties: false },
);

export type SubagentToolPermissionDecisionPatch = Static<
  typeof SubagentVariantToolPermissionDecisionSchema
>;
export type SubagentAgentVariantPatch = Static<typeof SubagentAgentVariantPatchSchema>;
export type SubagentAgentPatch = Static<typeof SubagentAgentPatchSchema>;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function normalizeSubagentPermissionMapInput(
  value: unknown,
  mode: "agent" | "variant",
): Static<typeof SubagentVariantToolPermissionMapSchema> | undefined {
  if (!isObjectRecord(value)) return undefined;

  const normalized: Record<string, SubagentToolPermissionDecisionPatch> = {};
  for (const [rawToolName, rawDecision] of Object.entries(value)) {
    const toolName = toTrimmedString(rawToolName)?.toLowerCase();
    if (!toolName) continue;
    if (typeof rawDecision !== "string") continue;

    const decision = rawDecision.trim().toLowerCase();
    if (decision !== "allow" && decision !== "deny" && decision !== "inherit") continue;
    if (mode === "agent" && decision === "inherit") continue;

    normalized[toolName] = decision;
  }

  const schema =
    mode === "agent" ? SubagentToolPermissionMapSchema : SubagentVariantToolPermissionMapSchema;
  if (!Value.Check(schema, normalized)) {
    return undefined;
  }

  return Value.Decode(schema, normalized);
}

function normalizeSubagentAgentVariantPatchInput(input: unknown): unknown {
  if (!isObjectRecord(input)) return input;

  const model = toTrimmedString(Reflect.get(input, "model"));
  const disabled = toBoolean(Reflect.get(input, "disabled"));
  const tools = toTrimmedStringArray(Reflect.get(input, "tools"));
  const maxTurns = toPositiveInteger(Reflect.get(input, "maxTurns"));
  const prompt = toTrimmedString(Reflect.get(input, "prompt"));
  const description = toTrimmedString(Reflect.get(input, "description"));
  const permissions = normalizeSubagentPermissionMapInput(
    Reflect.get(input, "permissions"),
    "variant",
  );

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

function normalizeSubagentAgentVariantMapInput(
  input: unknown,
): Static<typeof SubagentAgentVariantMapPatchSchema> | undefined {
  if (!isObjectRecord(input)) return undefined;

  const normalized: Record<string, SubagentAgentVariantPatch> = {};
  for (const [rawPattern, rawVariant] of Object.entries(input)) {
    const pattern = toTrimmedString(rawPattern)?.toLowerCase();
    if (!pattern) continue;

    const normalizedVariant = normalizeSubagentAgentVariantPatchInput(rawVariant);
    if (!Value.Check(SubagentAgentVariantPatchSchema, normalizedVariant)) {
      continue;
    }

    normalized[pattern] = Value.Decode(SubagentAgentVariantPatchSchema, normalizedVariant);
  }

  if (!Value.Check(SubagentAgentVariantMapPatchSchema, normalized)) {
    return undefined;
  }

  return Value.Decode(SubagentAgentVariantMapPatchSchema, normalized);
}

function normalizeSubagentAgentPatchInput(input: unknown): unknown {
  if (!isObjectRecord(input)) return input;

  const model = toTrimmedString(Reflect.get(input, "model"));
  const disabled = toBoolean(Reflect.get(input, "disabled"));
  const tools = toTrimmedStringArray(Reflect.get(input, "tools"));
  const maxTurns = toPositiveInteger(Reflect.get(input, "maxTurns"));
  const prompt = toTrimmedString(Reflect.get(input, "prompt"));
  const description = toTrimmedString(Reflect.get(input, "description"));
  const permissions = normalizeSubagentPermissionMapInput(
    Reflect.get(input, "permissions"),
    "agent",
  );
  const variants = normalizeSubagentAgentVariantMapInput(Reflect.get(input, "variants"));

  return {
    ...(disabled !== undefined ? { disabled } : {}),
    ...(model ? { model } : {}),
    ...(tools ? { tools } : {}),
    ...(maxTurns ? { maxTurns } : {}),
    ...(prompt ? { prompt } : {}),
    ...(description ? { description } : {}),
    ...(permissions ? { permissions } : {}),
    ...(variants ? { variants } : {}),
  };
}

export function parseSubagentAgentVariantPatch(
  input: unknown,
): SubagentAgentVariantPatch | undefined {
  const normalized = normalizeSubagentAgentVariantPatchInput(input);
  if (!Value.Check(SubagentAgentVariantPatchSchema, normalized)) {
    return undefined;
  }

  return Value.Decode(SubagentAgentVariantPatchSchema, normalized);
}

export function parseSubagentAgentPatch(input: unknown): SubagentAgentPatch | undefined {
  const normalized = normalizeSubagentAgentPatchInput(input);
  if (!Value.Check(SubagentAgentPatchSchema, normalized)) {
    return undefined;
  }

  return Value.Decode(SubagentAgentPatchSchema, normalized);
}
