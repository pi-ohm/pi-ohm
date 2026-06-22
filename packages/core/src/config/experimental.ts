import { Type, type TSchema, type TUnsafe } from "typebox";

export interface ExperimentalFlagInput {
  readonly defaultEnabled: boolean;
  readonly description: string;
}

export interface ExperimentalFlagMetadata {
  readonly namespace: string;
  readonly key: string;
  readonly defaultEnabled: boolean;
  readonly description: string;
}

export interface ExperimentalFlagConfig {
  readonly enabled: boolean;
}

export interface ExperimentalFlagsConfig {
  readonly [key: string]: ExperimentalFlagConfig;
}

export interface ExperimentalFlagPatch {
  readonly enabled?: boolean;
}

export interface ExperimentalFlagsPatch {
  readonly [key: string]: ExperimentalFlagPatch | undefined;
}

export interface ExperimentalFlagsDefinition {
  readonly namespace: string;
  readonly schema: TUnsafe<ExperimentalFlagsPatch>;
  readonly defaults: ExperimentalFlagsConfig;
  readonly flags: readonly ExperimentalFlagMetadata[];
  enabled(config: ExperimentalFlagsConfig, key: string): boolean | undefined;
  is(value: unknown): value is ExperimentalFlagsConfig;
  merge(
    base: ExperimentalFlagsConfig,
    patch: ExperimentalFlagsPatch | undefined,
  ): ExperimentalFlagsConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 0) return trimmed;
  throw new Error(`${label} must be a non-empty string`);
}

function normalizeFlags(
  namespace: string,
  input: Readonly<Record<string, ExperimentalFlagInput>>,
): readonly ExperimentalFlagMetadata[] {
  const normalized = Object.entries(input).map(([rawKey, flag]) => ({
    namespace,
    key: requiredText(rawKey, "Experimental flag key"),
    defaultEnabled: flag.defaultEnabled,
    description: requiredText(flag.description, `Experimental flag ${rawKey} description`),
  }));
  const keys = new Set<string>();
  for (const flag of normalized) {
    if (keys.has(flag.key)) throw new Error(`Duplicate experimental flag key: ${flag.key}`);
    keys.add(flag.key);
  }
  return normalized;
}

function createFlagSchema(flag: ExperimentalFlagMetadata): TSchema {
  return Type.Object(
    {
      enabled: Type.Optional(
        Type.Boolean({
          default: flag.defaultEnabled,
          description: flag.description,
        }),
      ),
    },
    {
      additionalProperties: false,
      description: flag.description,
    },
  );
}

function createSchema(
  namespace: string,
  flags: readonly ExperimentalFlagMetadata[],
): TUnsafe<ExperimentalFlagsPatch> {
  const properties: Record<string, TSchema> = {};
  for (const flag of flags) properties[flag.key] = Type.Optional(createFlagSchema(flag));
  return Type.Unsafe<ExperimentalFlagsPatch>({
    type: "object",
    properties,
    additionalProperties: false,
    description: `Experimental ${namespace} config`,
  });
}

function createDefaults(flags: readonly ExperimentalFlagMetadata[]): ExperimentalFlagsConfig {
  const defaults: Record<string, ExperimentalFlagConfig> = {};
  for (const flag of flags) defaults[flag.key] = { enabled: flag.defaultEnabled };
  return defaults;
}

function isFlagConfig(value: unknown): value is ExperimentalFlagConfig {
  if (!isRecord(value)) return false;
  return typeof Reflect.get(value, "enabled") === "boolean";
}

export function defineExperimentalFlags(
  rawNamespace: string,
  input: Readonly<Record<string, ExperimentalFlagInput>>,
): ExperimentalFlagsDefinition {
  const namespace = requiredText(rawNamespace, "Experimental flag namespace");
  const flags = normalizeFlags(namespace, input);
  const keys = new Set(flags.map((flag) => flag.key));
  const defaults = createDefaults(flags);

  return {
    namespace,
    schema: createSchema(namespace, flags),
    defaults,
    flags,
    enabled(config, key) {
      return config[key]?.enabled;
    },
    is(value: unknown): value is ExperimentalFlagsConfig {
      if (!isRecord(value)) return false;
      for (const key of Object.keys(value)) {
        if (!keys.has(key)) return false;
      }
      for (const flag of flags) {
        if (!isFlagConfig(Reflect.get(value, flag.key))) return false;
      }
      return true;
    },
    merge(base, patch) {
      const merged: Record<string, ExperimentalFlagConfig> = {};
      for (const flag of flags) {
        const fallback = base[flag.key] ?? defaults[flag.key];
        const next = patch?.[flag.key];
        merged[flag.key] = {
          enabled: next?.enabled ?? fallback.enabled,
        };
      }
      return merged;
    },
  };
}
