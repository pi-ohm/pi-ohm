import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const NonEmptyStringSchema = Type.String({ minLength: 1 });
const NonEmptyStringArraySchema = Type.Array(NonEmptyStringSchema, { minItems: 1 });

export const SubagentToolPermissionDecisionSchema = Type.Union([
  Type.Literal("allow"),
  Type.Literal("deny"),
  Type.Literal("inherit"),
  Type.Literal("ask"),
]);

export const SubagentToolPermissionMapSchema = Type.Record(
  NonEmptyStringSchema,
  SubagentToolPermissionDecisionSchema,
);

export const SubagentProfileVariantPatchSchema = Type.Object(
  {
    model: Type.Optional(NonEmptyStringSchema),
    prompt: Type.Optional(NonEmptyStringSchema),
    description: Type.Optional(NonEmptyStringSchema),
    whenToUse: Type.Optional(NonEmptyStringArraySchema),
    permissions: Type.Optional(SubagentToolPermissionMapSchema),
  },
  { additionalProperties: false },
);

export const SubagentProfileVariantMapPatchSchema = Type.Record(
  NonEmptyStringSchema,
  SubagentProfileVariantPatchSchema,
);

export const SubagentProfilePatchSchema = Type.Object(
  {
    model: Type.Optional(NonEmptyStringSchema),
    prompt: Type.Optional(NonEmptyStringSchema),
    description: Type.Optional(NonEmptyStringSchema),
    whenToUse: Type.Optional(NonEmptyStringArraySchema),
    permissions: Type.Optional(SubagentToolPermissionMapSchema),
    variants: Type.Optional(SubagentProfileVariantMapPatchSchema),
  },
  { additionalProperties: false },
);

export type SubagentToolPermissionDecisionPatch = Static<
  typeof SubagentToolPermissionDecisionSchema
>;
export type SubagentProfileVariantPatch = Static<typeof SubagentProfileVariantPatchSchema>;
export type SubagentProfilePatch = Static<typeof SubagentProfilePatchSchema>;

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

function normalizeSubagentPermissionMapInput(
  value: unknown,
): Static<typeof SubagentToolPermissionMapSchema> | undefined {
  if (!isObjectRecord(value)) return undefined;

  const normalized: Record<string, SubagentToolPermissionDecisionPatch> = {};
  for (const [rawToolName, rawDecision] of Object.entries(value)) {
    const toolName = toTrimmedString(rawToolName)?.toLowerCase();
    if (!toolName) continue;
    if (typeof rawDecision !== "string") continue;

    const decision = rawDecision.trim().toLowerCase();
    if (
      decision !== "allow" &&
      decision !== "deny" &&
      decision !== "inherit" &&
      decision !== "ask"
    ) {
      continue;
    }

    normalized[toolName] = decision;
  }

  if (!Value.Check(SubagentToolPermissionMapSchema, normalized)) {
    return undefined;
  }

  return Value.Decode(SubagentToolPermissionMapSchema, normalized);
}

function normalizeSubagentProfileVariantPatchInput(input: unknown): unknown {
  if (!isObjectRecord(input)) return input;

  const model = toTrimmedString(Reflect.get(input, "model"));
  const prompt = toTrimmedString(Reflect.get(input, "prompt"));
  const description = toTrimmedString(Reflect.get(input, "description"));
  const whenToUse = toTrimmedStringArray(Reflect.get(input, "whenToUse"));
  const permissions = normalizeSubagentPermissionMapInput(Reflect.get(input, "permissions"));

  return {
    ...(model ? { model } : {}),
    ...(prompt ? { prompt } : {}),
    ...(description ? { description } : {}),
    ...(whenToUse ? { whenToUse } : {}),
    ...(permissions ? { permissions } : {}),
  };
}

function normalizeSubagentProfileVariantMapInput(
  input: unknown,
): Static<typeof SubagentProfileVariantMapPatchSchema> | undefined {
  if (!isObjectRecord(input)) return undefined;

  const normalized: Record<string, SubagentProfileVariantPatch> = {};
  for (const [rawPattern, rawVariant] of Object.entries(input)) {
    const pattern = toTrimmedString(rawPattern)?.toLowerCase();
    if (!pattern) continue;

    const normalizedVariant = normalizeSubagentProfileVariantPatchInput(rawVariant);
    if (!Value.Check(SubagentProfileVariantPatchSchema, normalizedVariant)) {
      continue;
    }

    normalized[pattern] = Value.Decode(SubagentProfileVariantPatchSchema, normalizedVariant);
  }

  if (!Value.Check(SubagentProfileVariantMapPatchSchema, normalized)) {
    return undefined;
  }

  return Value.Decode(SubagentProfileVariantMapPatchSchema, normalized);
}

function normalizeSubagentProfilePatchInput(input: unknown): unknown {
  if (!isObjectRecord(input)) return input;

  const model = toTrimmedString(Reflect.get(input, "model"));
  const prompt = toTrimmedString(Reflect.get(input, "prompt"));
  const description = toTrimmedString(Reflect.get(input, "description"));
  const whenToUse = toTrimmedStringArray(Reflect.get(input, "whenToUse"));
  const permissions = normalizeSubagentPermissionMapInput(Reflect.get(input, "permissions"));
  const variants = normalizeSubagentProfileVariantMapInput(Reflect.get(input, "variants"));

  return {
    ...(model ? { model } : {}),
    ...(prompt ? { prompt } : {}),
    ...(description ? { description } : {}),
    ...(whenToUse ? { whenToUse } : {}),
    ...(permissions ? { permissions } : {}),
    ...(variants ? { variants } : {}),
  };
}

export function parseSubagentProfileVariantPatch(
  input: unknown,
): SubagentProfileVariantPatch | undefined {
  const normalized = normalizeSubagentProfileVariantPatchInput(input);
  if (!Value.Check(SubagentProfileVariantPatchSchema, normalized)) {
    return undefined;
  }

  return Value.Decode(SubagentProfileVariantPatchSchema, normalized);
}

export function parseSubagentProfilePatch(input: unknown): SubagentProfilePatch | undefined {
  const normalized = normalizeSubagentProfilePatchInput(input);
  if (!Value.Check(SubagentProfilePatchSchema, normalized)) {
    return undefined;
  }

  return Value.Decode(SubagentProfilePatchSchema, normalized);
}
