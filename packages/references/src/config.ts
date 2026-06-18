import path from "node:path";
import { Result } from "better-result";
import { Type, type StaticDecode } from "typebox";
import { Value } from "typebox/value";
import { loadConfig, pickConfig, registerConfig } from "@pi-ohm/core/config";

export const LocalReferenceConfigSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String()),
    hidden: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const GitReferenceConfigSchema = Type.Object(
  {
    repository: Type.String({ minLength: 1 }),
    branch: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    hidden: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const ReferenceEntryConfigSchema = Type.Union([
  Type.String({ minLength: 1 }),
  LocalReferenceConfigSchema,
  GitReferenceConfigSchema,
]);

export const ReferencesConfigSchema = Type.Record(
  Type.String({ minLength: 1 }),
  ReferenceEntryConfigSchema,
);

type ReferencesConfigPatch = StaticDecode<typeof ReferencesConfigSchema>;

export interface LocalReferenceConfig {
  readonly path: string;
  readonly description?: string;
  readonly hidden?: boolean;
}

export interface GitReferenceConfig {
  readonly repository: string;
  readonly branch?: string;
  readonly description?: string;
  readonly hidden?: boolean;
}

export type ReferenceEntryConfig = string | LocalReferenceConfig | GitReferenceConfig;
export type ReferencesRuntimeConfig = Readonly<Record<string, ReferenceEntryConfig>>;

const DEFAULT_REFERENCES_CONFIG: ReferencesRuntimeConfig = {};

export const referencesConfigModule = registerConfig({
  namespace: "references",
  schema: ReferencesConfigSchema,
  defaults: DEFAULT_REFERENCES_CONFIG,
  merge(base: ReferencesRuntimeConfig, patch: ReferencesConfigPatch) {
    return Result.ok(mergeReferencesConfig(base, patch));
  },
});

function trimString(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function optionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return trimString(value);
}

function normalizeEntry(entry: ReferenceEntryConfig): ReferenceEntryConfig | undefined {
  if (typeof entry === "string") return trimString(entry);

  if ("path" in entry) {
    const resolved = trimString(entry.path);
    if (!resolved) return undefined;
    return {
      path: resolved,
      ...(optionalString(entry.description)
        ? { description: optionalString(entry.description) }
        : {}),
      ...(entry.hidden !== undefined ? { hidden: entry.hidden } : {}),
    };
  }

  const repository = trimString(entry.repository);
  if (!repository) return undefined;
  return {
    repository,
    ...(optionalString(entry.branch) ? { branch: optionalString(entry.branch) } : {}),
    ...(optionalString(entry.description)
      ? { description: optionalString(entry.description) }
      : {}),
    ...(entry.hidden !== undefined ? { hidden: entry.hidden } : {}),
  };
}

export function validReferenceAlias(name: string): boolean {
  return name.length > 0 && !/[/\s`,]/.test(name);
}

export function mergeReferencesConfig(
  current: ReferencesRuntimeConfig | undefined,
  patch: ReferencesConfigPatch,
): ReferencesRuntimeConfig {
  const entries = Object.entries(patch).reduce<Record<string, ReferenceEntryConfig>>(
    (next, [rawName, rawEntry]) => {
      const name = rawName.trim();
      if (!validReferenceAlias(name)) return next;

      const entry = normalizeEntry(rawEntry);
      if (!entry) return next;

      return { ...next, [name]: entry };
    },
    { ...(current ?? DEFAULT_REFERENCES_CONFIG) },
  );

  return entries;
}

export function isReferencesRuntimeConfig(value: unknown): value is ReferencesRuntimeConfig {
  return Value.Check(ReferencesConfigSchema, value);
}

export async function loadReferencesConfig(cwd: string) {
  const loaded = await loadConfig({ cwd: path.resolve(cwd), modules: [referencesConfigModule] });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const config = pickConfig({
    loaded: loaded.value,
    module: referencesConfigModule,
    is: isReferencesRuntimeConfig,
  });
  if (Result.isError(config)) return Result.err(config.error);

  return Result.ok({ loaded: loaded.value, config: config.value });
}
