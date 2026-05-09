import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Result, TaggedError, type Result as BetterResult } from "better-result";
import type { StaticDecode, TSchema } from "typebox";
import { Value } from "typebox/value";
import { DEFAULT_OHM_FEATURE_FLAGS, mergeOhmFeatureFlags, type OhmFeatureFlags } from "./features";
import { DEFAULT_OHM_MODE, normalizeOhmMode, type OhmMode } from "./modes";
import {
  DEFAULT_OHM_PAINTER_PROVIDERS,
  mergeOhmPainterProviders,
  type OhmPainterProviders,
} from "./painter";
import {
  DEFAULT_OHM_SUBAGENT_RUNTIME_CONFIG,
  mergeSubagentRuntimeConfig,
  type OhmSubagentRuntimeConfig,
} from "./subagents";

export const OHM_EXTENSION_NAME = "pi-ohm";
export type OhmSubagentBackend = "none" | "interactive-shell" | "interactive-sdk" | "custom-plugin";

export interface OhmRuntimeConfig {
  defaultMode: OhmMode;
  subagentBackend: OhmSubagentBackend;
  features: OhmFeatureFlags;
  painter: OhmPainterProviders;
  subagents?: OhmSubagentRuntimeConfig;
}

export interface OhmConfigPaths {
  configDir: string;
  projectConfigFile: string;
  globalConfigFile: string;
  providersConfigFile: string;
}

export interface LoadedOhmRuntimeConfig {
  config: OhmRuntimeConfig;
  paths: OhmConfigPaths;
  loadedFrom: readonly string[];
  diagnostics?: readonly OhmConfigDiagnostic[];
}

export type OhmConfigDiagnostic =
  | {
      readonly kind: "read-failed";
      readonly path: string;
      readonly message: string;
      readonly cause?: unknown;
    }
  | {
      readonly kind: "invalid-json";
      readonly path: string;
      readonly message: string;
      readonly cause?: unknown;
    }
  | {
      readonly kind: "invalid-root";
      readonly path: string;
      readonly message: string;
    }
  | {
      readonly kind: "invalid-schema";
      readonly path: string;
      readonly namespace: string;
      readonly message: string;
      readonly errors: readonly string[];
    }
  | {
      readonly kind: "merge-failed";
      readonly path: string;
      readonly namespace: string;
      readonly message: string;
      readonly cause: OhmConfigModuleError;
    };

export class OhmConfigModuleError extends TaggedError("OhmConfigModuleError")<{
  readonly code: string;
  readonly message: string;
  readonly namespace?: string;
  readonly cause?: unknown;
}>() {}

export class OhmConfigRuntimeError extends TaggedError("OhmConfigRuntimeError")<{
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}>() {}

export type OhmConfigResult<T> = BetterResult<T, OhmConfigModuleError>;
export type OhmConfigLoadResult<T> = BetterResult<T, OhmConfigRuntimeError>;

export interface OhmConfigModule<
  Config = unknown,
  Schema extends TSchema = TSchema,
> extends OhmRegisteredConfigModule {
  readonly namespace: string;
  readonly schema: Schema;
  readonly defaults: Config;
  readonly merge: (
    base: Config,
    patch: StaticDecode<Schema>,
  ) => OhmConfigResult<Config> | Promise<OhmConfigResult<Config>>;
}

export interface RegisterOhmConfigInput<Config, Schema extends TSchema> {
  readonly namespace: string;
  readonly schema: Schema;
  readonly defaults: Config;
  readonly merge: (
    base: Config,
    patch: StaticDecode<Schema>,
  ) => OhmConfigResult<Config> | Promise<OhmConfigResult<Config>>;
}

export interface LoadRegisteredConfigInput {
  readonly cwd: string;
  readonly modules: readonly OhmRegisteredConfigModule[];
}

interface ModuleLoadedConfig {
  readonly namespace: string;
  readonly value: unknown;
  readonly loadedFrom: readonly string[];
  readonly diagnostics: readonly OhmConfigDiagnostic[];
}

export interface OhmRegisteredConfigModule {
  readonly namespace: string;
  readonly schema: TSchema;
  readonly defaults: unknown;
  readonly load: (files: readonly ReadConfigFileResult[]) => Promise<ModuleLoadedConfig>;
}

export interface LoadedRegisteredConfig {
  readonly config: Readonly<Record<string, unknown>>;
  readonly paths: OhmConfigPaths;
  readonly loadedFrom: readonly string[];
  readonly diagnostics: readonly OhmConfigDiagnostic[];
}

const DEFAULT_OHM_CONFIG: OhmRuntimeConfig = {
  defaultMode: DEFAULT_OHM_MODE,
  subagentBackend: "interactive-sdk",
  features: DEFAULT_OHM_FEATURE_FLAGS,
  painter: DEFAULT_OHM_PAINTER_PROVIDERS,
  subagents: DEFAULT_OHM_SUBAGENT_RUNTIME_CONFIG,
};

type JsonMap = Record<string, unknown>;

interface ReadConfigFileResult {
  readonly path: string;
  readonly value: JsonMap | undefined;
  readonly diagnostic?: OhmConfigDiagnostic;
}

function isJsonMap(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(value: unknown, code: string): boolean {
  if (!isJsonMap(value)) return false;
  return value.code === code;
}

function causeMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (typeof cause === "string" && cause.trim().length > 0) return cause;
  return String(cause);
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function resolveOhmConfigDir(): string {
  const envDir =
    process.env.PI_CONFIG_DIR ?? process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR;

  if (envDir && envDir.trim().length > 0) {
    return expandHome(envDir.trim());
  }

  return path.join(os.homedir(), ".pi", "agent");
}

export function resolveOhmConfigPaths(cwd: string): OhmConfigPaths {
  const configDir = resolveOhmConfigDir();
  return {
    configDir,
    projectConfigFile: path.join(cwd, ".pi", "ohm.json"),
    globalConfigFile: path.join(configDir, "ohm.json"),
    providersConfigFile: path.join(configDir, "ohm.providers.json"),
  };
}

export function registerConfig<Config, Schema extends TSchema>(
  input: RegisterOhmConfigInput<Config, Schema>,
): OhmConfigModule<Config, Schema> {
  return {
    namespace: input.namespace,
    schema: input.schema,
    defaults: input.defaults,
    merge: input.merge,
    load: async (files) => {
      const loaded = await applyConfigFiles({ input, files });
      return {
        namespace: input.namespace,
        value: loaded.value,
        loadedFrom: loaded.loadedFrom,
        diagnostics: loaded.diagnostics,
      };
    },
  };
}

async function readConfigFile(file: string): Promise<ReadConfigFileResult> {
  const raw = await Result.tryPromise({
    try: async () => fs.readFile(file, "utf8"),
    catch: (cause) => cause,
  });

  if (Result.isError(raw)) {
    if (isNodeErrorCode(raw.error, "ENOENT")) {
      return { path: file, value: undefined };
    }

    return {
      path: file,
      value: undefined,
      diagnostic: {
        kind: "read-failed",
        path: file,
        message: `Failed to read Ohm config: ${file}`,
        cause: raw.error,
      },
    };
  }

  const parsed = Result.try({
    try: () => JSON.parse(raw.value),
    catch: (cause) => cause,
  });

  if (Result.isError(parsed)) {
    return {
      path: file,
      value: undefined,
      diagnostic: {
        kind: "invalid-json",
        path: file,
        message: `Failed to parse Ohm config JSON: ${file}: ${causeMessage(parsed.error)}`,
        cause: parsed.error,
      },
    };
  }

  if (!isJsonMap(parsed.value)) {
    return {
      path: file,
      value: undefined,
      diagnostic: {
        kind: "invalid-root",
        path: file,
        message: `Ohm config root must be a JSON object: ${file}`,
      },
    };
  }

  return { path: file, value: parsed.value };
}

function schemaErrors(schema: TSchema, value: unknown): readonly string[] {
  return Array.from(Value.Errors(schema, value), (error) => error.message);
}

async function mergeConfigModule<Config, Schema extends TSchema>(input: {
  readonly module: RegisterOhmConfigInput<Config, Schema>;
  readonly current: Config;
  readonly patch: unknown;
  readonly file: string;
}): Promise<
  | { readonly status: "applied"; readonly value: Config }
  | { readonly status: "skipped"; readonly diagnostic: OhmConfigDiagnostic }
> {
  if (!Value.Check(input.module.schema, input.patch)) {
    const errors = schemaErrors(input.module.schema, input.patch);
    return {
      status: "skipped",
      diagnostic: {
        kind: "invalid-schema",
        path: input.file,
        namespace: input.module.namespace,
        message: `Invalid Ohm config for namespace "${input.module.namespace}" in ${input.file}`,
        errors,
      },
    };
  }

  const decoded = Value.Decode(input.module.schema, input.patch);
  const merged = await input.module.merge(input.current, decoded);

  if (Result.isError(merged)) {
    return {
      status: "skipped",
      diagnostic: {
        kind: "merge-failed",
        path: input.file,
        namespace: input.module.namespace,
        message: `Failed to merge Ohm config for namespace "${input.module.namespace}" in ${input.file}`,
        cause: merged.error,
      },
    };
  }

  return { status: "applied", value: merged.value };
}

interface ConfigModuleState<Config> {
  readonly value: Config;
  readonly loadedFrom: readonly string[];
  readonly diagnostics: readonly OhmConfigDiagnostic[];
}

async function applyConfigFiles<Config, Schema extends TSchema>(input: {
  readonly input: RegisterOhmConfigInput<Config, Schema>;
  readonly files: readonly ReadConfigFileResult[];
}): Promise<ConfigModuleState<Config>> {
  const initial: ConfigModuleState<Config> = {
    value: structuredClone(input.input.defaults),
    loadedFrom: [],
    diagnostics: [],
  };

  return input.files.reduce<Promise<ConfigModuleState<Config>>>(async (previous, file) => {
    const state = await previous;
    if (!file.value) return state;

    const patch = Reflect.get(file.value, input.input.namespace);
    if (patch === undefined) return state;

    const merged = await mergeConfigModule({
      module: input.input,
      current: state.value,
      patch,
      file: file.path,
    });

    if (merged.status === "skipped") {
      return {
        value: state.value,
        loadedFrom: state.loadedFrom,
        diagnostics: [...state.diagnostics, merged.diagnostic],
      };
    }

    return {
      value: merged.value,
      loadedFrom: [...state.loadedFrom, file.path],
      diagnostics: state.diagnostics,
    };
  }, Promise.resolve(initial));
}

interface RegisteredLoadState {
  readonly config: Readonly<Record<string, unknown>>;
  readonly loadedFrom: readonly string[];
  readonly diagnostics: readonly OhmConfigDiagnostic[];
}

interface RuntimeLoadState {
  readonly config: OhmRuntimeConfig;
  readonly loadedFrom: readonly string[];
}

export async function loadRegisteredConfig(
  input: LoadRegisteredConfigInput,
): Promise<OhmConfigLoadResult<LoadedRegisteredConfig>> {
  const paths = resolveOhmConfigPaths(input.cwd);
  const files = [
    await readConfigFile(paths.globalConfigFile),
    await readConfigFile(paths.projectConfigFile),
  ];
  const fileDiagnostics = files
    .map((file) => file.diagnostic)
    .filter((diagnostic): diagnostic is OhmConfigDiagnostic => diagnostic !== undefined);

  const initial: RegisteredLoadState = {
    config: {},
    loadedFrom: [],
    diagnostics: [...fileDiagnostics],
  };

  const loaded = await input.modules.reduce<Promise<RegisteredLoadState>>(
    async (previous, module) => {
      const state = await previous;
      const moduleLoaded = await module.load(files);

      return {
        config: {
          ...state.config,
          [module.namespace]: moduleLoaded.value,
        },
        loadedFrom: [...state.loadedFrom, ...moduleLoaded.loadedFrom].filter(
          (file, index, all) => all.indexOf(file) === index,
        ),
        diagnostics: [...state.diagnostics, ...moduleLoaded.diagnostics],
      };
    },
    Promise.resolve(initial),
  );

  const loadedFrom = files
    .map((file) => file.path)
    .filter((file) => loaded.loadedFrom.includes(file));

  return Result.ok({
    config: loaded.config,
    paths,
    loadedFrom,
    diagnostics: loaded.diagnostics,
  });
}

function normalizeSubagentBackend(
  value: unknown,
  fallback: OhmSubagentBackend,
): OhmSubagentBackend {
  if (
    value === "none" ||
    value === "interactive-shell" ||
    value === "interactive-sdk" ||
    value === "custom-plugin"
  ) {
    return value;
  }
  return fallback;
}

function mergeConfig(base: OhmRuntimeConfig, patch: JsonMap): OhmRuntimeConfig {
  const next: OhmRuntimeConfig = structuredClone(base);

  next.defaultMode = normalizeOhmMode(patch.defaultMode, next.defaultMode);
  next.subagentBackend = normalizeSubagentBackend(patch.subagentBackend, next.subagentBackend);

  next.features = mergeOhmFeatureFlags(next.features, patch.features);
  next.painter = mergeOhmPainterProviders(next.painter, patch.painter);

  next.subagents = mergeSubagentRuntimeConfig({
    current: next.subagents,
    patch: patch.subagents,
  });

  return next;
}

function applyExtensionSettings(config: OhmRuntimeConfig): OhmRuntimeConfig {
  return config;
}

export async function loadOhmRuntimeConfig(cwd: string): Promise<LoadedOhmRuntimeConfig> {
  const paths = resolveOhmConfigPaths(cwd);
  const files = [
    await readConfigFile(paths.globalConfigFile),
    await readConfigFile(paths.projectConfigFile),
    await readConfigFile(paths.providersConfigFile),
  ];

  const configFiles = files.map((file) => {
    if (file.path !== paths.providersConfigFile) return file;
    if (!file.value) return file;
    return { path: file.path, value: { painter: file.value } };
  });

  const diagnostics = configFiles
    .map((file) => file.diagnostic)
    .filter((diagnostic): diagnostic is OhmConfigDiagnostic => diagnostic !== undefined);

  const initial: RuntimeLoadState = {
    config: structuredClone(DEFAULT_OHM_CONFIG),
    loadedFrom: [],
  };

  const state = configFiles.reduce<RuntimeLoadState>((current, file) => {
    if (!file.value) return current;
    return {
      config: mergeConfig(current.config, file.value),
      loadedFrom: [...current.loadedFrom, file.path],
    };
  }, initial);

  return {
    config: applyExtensionSettings(state.config),
    paths,
    loadedFrom: state.loadedFrom,
    diagnostics,
  };
}

export function registerOhmSettings(_pi: unknown): void {}

export function getOhmSetting(settingId: string, defaultValue?: string): string | undefined {
  return defaultValue;
}

export function setOhmSetting(settingId: string, value: string): void {
  void settingId;
  void value;
}

export function getDefaultOhmConfig(): OhmRuntimeConfig {
  return structuredClone(DEFAULT_OHM_CONFIG);
}

export { DEFAULT_OHM_FEATURE_FLAGS, mergeOhmFeatureFlags, type OhmFeatureFlags } from "./features";
export { DEFAULT_OHM_MODE, normalizeOhmMode, type OhmMode } from "./modes";
export {
  DEFAULT_OHM_PAINTER_PROVIDERS,
  mergeOhmPainterProviders,
  type OhmPainterProviders,
} from "./painter";

export {
  DEFAULT_OHM_SUBAGENT_RUNTIME_CONFIG,
  getSubagentConfiguredModel,
  getSubagentProfileRuntimeConfig,
  mergeSubagentRuntimeConfig,
  resolveSubagentProfileRuntimeConfig,
  resolveSubagentVariantPattern,
  type OhmSubagentProfileRuntimeConfig,
  type OhmSubagentProfileVariantRuntimeConfig,
  type OhmSubagentRuntimeConfig,
  type OhmSubagentToolPermissionDecision,
  type ResolvedOhmSubagentProfileRuntimeConfig,
} from "./subagents";

export {
  parseSubagentProfilePatch,
  parseSubagentProfileVariantPatch,
  SubagentProfilePatchSchema,
  SubagentProfileVariantMapPatchSchema,
  SubagentProfileVariantPatchSchema,
  SubagentToolPermissionDecisionSchema,
  SubagentToolPermissionMapSchema,
  type SubagentProfilePatch,
  type SubagentProfileVariantPatch,
  type SubagentToolPermissionDecisionPatch,
} from "./subagents";
