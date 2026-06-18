import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Result, TaggedError, type Result as BetterResult } from "better-result";
import chokidar, { type FSWatcher } from "chokidar";
import { Type, type StaticDecode, type TSchema } from "typebox";
import { Value } from "typebox/value";

export interface ExtensionConfigPaths {
  configDir: string;
  projectConfigFile: string;
  globalConfigFile: string;
}

export type ExtensionConfigDiagnostic =
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
      readonly cause: ExtensionConfigModuleError;
    };

export class ExtensionConfigModuleError extends TaggedError("ExtensionConfigModuleError")<{
  readonly code: string;
  readonly message: string;
  readonly namespace?: string;
  readonly cause?: unknown;
}>() {}

export class ExtensionConfigRuntimeError extends TaggedError("ExtensionConfigRuntimeError")<{
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}>() {}

export type ExtensionConfigResult<T> = BetterResult<T, ExtensionConfigModuleError>;
export type ExtensionConfigLoadResult<T> = BetterResult<T, ExtensionConfigRuntimeError>;

export interface ExtensionConfigModule<
  Config = unknown,
  Schema extends TSchema = TSchema,
> extends RegisteredConfigModule {
  readonly namespace: string;
  readonly schema: Schema;
  readonly defaults: Config;
  readonly merge: (
    base: Config,
    patch: StaticDecode<Schema>,
  ) => ExtensionConfigResult<Config> | Promise<ExtensionConfigResult<Config>>;
}

export interface RegisterConfigInput<Config, Schema extends TSchema> {
  readonly namespace: string;
  readonly schema: Schema;
  readonly defaults: Config;
  readonly merge: (
    base: Config,
    patch: StaticDecode<Schema>,
  ) => ExtensionConfigResult<Config> | Promise<ExtensionConfigResult<Config>>;
}

export interface LoadConfigInput {
  readonly cwd: string;
  readonly modules: readonly RegisteredConfigModule[];
}

export interface WatchConfigInput extends LoadConfigInput {
  readonly debounceMs?: number;
  readonly canApply?: () => boolean;
}

export type ConfigSubscriber = (config: LoadedExtensionConfig) => void | Promise<void>;

export interface WatchedConfig {
  start(): Promise<ExtensionConfigLoadResult<LoadedExtensionConfig>>;
  get(): LoadedExtensionConfig | undefined;
  pending(): LoadedExtensionConfig | undefined;
  reload(): Promise<ExtensionConfigLoadResult<LoadedExtensionConfig>>;
  flush(): Promise<ExtensionConfigLoadResult<LoadedExtensionConfig | undefined>>;
  subscribe(subscriber: ConfigSubscriber): () => void;
  stop(): Promise<void>;
}

export interface ConfigRegistryInput {
  readonly cwd: string;
}

interface ModuleLoadedConfig {
  readonly namespace: string;
  readonly value: unknown;
  readonly loadedFrom: readonly string[];
  readonly diagnostics: readonly ExtensionConfigDiagnostic[];
}

export interface RegisteredConfigModule {
  readonly namespace: string;
  readonly schema: TSchema;
  readonly defaults: unknown;
  readonly load: (files: readonly ReadConfigFileResult[]) => Promise<ModuleLoadedConfig>;
}

export interface LoadedExtensionConfig {
  readonly config: Readonly<Record<string, unknown>>;
  readonly paths: ExtensionConfigPaths;
  readonly loadedFrom: readonly string[];
  readonly diagnostics: readonly ExtensionConfigDiagnostic[];
}

export interface PickConfigInput<Config> {
  readonly loaded: LoadedExtensionConfig;
  readonly module: RegisteredConfigModule;
  readonly is: (value: unknown) => value is Config;
}

const GLOBAL_CONFIG_MODULES = new Map<string, RegisteredConfigModule>();

export class ConfigRegistry {
  readonly cwd: string;
  readonly #modules: RegisteredConfigModule[] = [];

  private constructor(input: ConfigRegistryInput) {
    this.cwd = input.cwd;
  }

  static create(input: ConfigRegistryInput): ExtensionConfigLoadResult<ConfigRegistry> {
    const cwd = input.cwd.trim();
    if (cwd.length === 0) {
      return Result.err(
        new ExtensionConfigRuntimeError({
          code: "config_cwd_empty",
          message: "Invalid extension config registry input: cwd must be a non-empty string",
        }),
      );
    }

    return Result.ok(new ConfigRegistry({ cwd }));
  }

  register(module: RegisteredConfigModule): ExtensionConfigLoadResult<void> {
    const namespace = module.namespace.trim();
    if (namespace.length === 0) {
      return Result.err(
        new ExtensionConfigRuntimeError({
          code: "config_namespace_empty",
          message: "Invalid extension config module: namespace must be a non-empty string",
        }),
      );
    }

    if (this.#modules.some((registered) => registered.namespace === namespace)) {
      return Result.err(
        new ExtensionConfigRuntimeError({
          code: "config_namespace_duplicate",
          message: `Invalid extension config module: namespace "${namespace}" is already registered`,
        }),
      );
    }

    this.#modules.push(module);
    return Result.ok(undefined);
  }

  modules(): readonly RegisteredConfigModule[] {
    return [...this.#modules];
  }

  async load(): Promise<ExtensionConfigLoadResult<LoadedExtensionConfig>> {
    return loadConfigModules({ cwd: this.cwd, modules: this.#modules });
  }
}

const JsonMapSchema = Type.Record(Type.String(), Type.Unknown());
type JsonMap = StaticDecode<typeof JsonMapSchema>;

interface ReadConfigFileResult {
  readonly path: string;
  readonly value: JsonMap | undefined;
  readonly diagnostic?: ExtensionConfigDiagnostic;
}

function isNodeErrorCode(value: unknown, code: string): boolean {
  if (!Value.Check(JsonMapSchema, value)) return false;
  return Reflect.get(value, "code") === code;
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

export function resolveExtensionConfigDir(): string {
  const envDir =
    process.env.PI_CONFIG_DIR ?? process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR;

  if (envDir && envDir.trim().length > 0) {
    return expandHome(envDir.trim());
  }

  return path.join(os.homedir(), ".pi", "agent");
}

export function resolveExtensionConfigPaths(cwd: string): ExtensionConfigPaths {
  const configDir = resolveExtensionConfigDir();
  return {
    configDir,
    projectConfigFile: path.join(cwd, ".pi", "ohm.json"),
    globalConfigFile: path.join(configDir, "ohm.json"),
  };
}

export function registerConfig<Config, Schema extends TSchema>(
  input: RegisterConfigInput<Config, Schema>,
): ExtensionConfigModule<Config, Schema> {
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

export function pickConfig<Config>(
  input: PickConfigInput<Config>,
): ExtensionConfigLoadResult<Config> {
  const value = input.loaded.config[input.module.namespace];
  if (input.is(value)) return Result.ok(value);

  return Result.err(
    new ExtensionConfigRuntimeError({
      code: "config_namespace_missing",
      message: `Loaded extension config is missing namespace "${input.module.namespace}"`,
    }),
  );
}

export function watchConfig(input: WatchConfigInput): WatchedConfig {
  return new WatchedExtensionConfig(input);
}

export function registerGlobalConfigModule(module: RegisteredConfigModule): void {
  const namespace = module.namespace.trim();
  if (namespace.length === 0) return;
  GLOBAL_CONFIG_MODULES.set(namespace, module);
}

export function getGlobalConfigModules(): readonly RegisteredConfigModule[] {
  return [...GLOBAL_CONFIG_MODULES.values()].sort((left, right) =>
    left.namespace.localeCompare(right.namespace),
  );
}

export function clearGlobalConfigModulesForTesting(): void {
  GLOBAL_CONFIG_MODULES.clear();
}

class WatchedExtensionConfig implements WatchedConfig {
  readonly #input: WatchConfigInput;
  readonly #subscribers = new Set<ConfigSubscriber>();
  #watcher: FSWatcher | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #current: LoadedExtensionConfig | undefined;
  #pending: LoadedExtensionConfig | undefined;
  #currentSnapshot = "";
  #started = false;

  constructor(input: WatchConfigInput) {
    this.#input = input;
  }

  async start(): Promise<ExtensionConfigLoadResult<LoadedExtensionConfig>> {
    if (this.#started) {
      const current = this.#current;
      if (current) return Result.ok(current);
    }

    const loaded = await loadConfig(this.#input);
    if (Result.isError(loaded)) return loaded;

    this.#started = true;
    this.#apply(loaded.value, false);
    this.#watcher = this.#createWatcher(loaded.value.paths);
    return Result.ok(loaded.value);
  }

  get(): LoadedExtensionConfig | undefined {
    return this.#current;
  }

  pending(): LoadedExtensionConfig | undefined {
    return this.#pending;
  }

  async reload(): Promise<ExtensionConfigLoadResult<LoadedExtensionConfig>> {
    const loaded = await loadConfig(this.#input);
    if (Result.isError(loaded)) return loaded;

    const next = this.#guardDiagnostics(loaded.value);
    if (this.#canApply()) {
      this.#apply(next, true);
      return Result.ok(next);
    }

    this.#pending = next;
    return Result.ok(next);
  }

  async flush(): Promise<ExtensionConfigLoadResult<LoadedExtensionConfig | undefined>> {
    const pending = this.#pending;
    if (!pending) return Result.ok(undefined);
    if (!this.#canApply()) return Result.ok(undefined);

    this.#pending = undefined;
    this.#apply(pending, true);
    return Result.ok(pending);
  }

  subscribe(subscriber: ConfigSubscriber): () => void {
    this.#subscribers.add(subscriber);
    return () => {
      this.#subscribers.delete(subscriber);
    };
  }

  async stop(): Promise<void> {
    this.#started = false;
    this.#pending = undefined;
    this.#subscribers.clear();
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    const watcher = this.#watcher;
    this.#watcher = undefined;
    if (watcher) await watcher.close();
  }

  #canApply(): boolean {
    return this.#input.canApply?.() ?? true;
  }

  #createWatcher(paths: ExtensionConfigPaths): FSWatcher {
    const watcher = chokidar.watch([paths.globalConfigFile, paths.projectConfigFile], {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: Math.max(this.#input.debounceMs ?? 100, 50),
        pollInterval: 10,
      },
    });
    watcher.on("all", () => {
      this.#scheduleReload();
    });
    return watcher;
  }

  #scheduleReload(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.reload();
    }, this.#input.debounceMs ?? 100);
  }

  #guardDiagnostics(next: LoadedExtensionConfig): LoadedExtensionConfig {
    const current = this.#current;
    if (!current || next.diagnostics.length === 0) return next;
    return {
      ...next,
      config: current.config,
      loadedFrom: current.loadedFrom,
    };
  }

  #apply(next: LoadedExtensionConfig, notify: boolean): void {
    const snapshot = comparableConfigSnapshot(next);
    if (snapshot === this.#currentSnapshot) {
      this.#current = next;
      return;
    }

    this.#current = next;
    this.#currentSnapshot = snapshot;
    if (!notify) return;
    for (const subscriber of this.#subscribers) {
      void Promise.resolve(subscriber(next)).catch(() => undefined);
    }
  }
}

function comparableConfigSnapshot(config: LoadedExtensionConfig): string {
  return JSON.stringify({
    config: config.config,
    loadedFrom: config.loadedFrom,
    diagnostics: config.diagnostics.map(comparableDiagnostic),
  });
}

function comparableDiagnostic(diagnostic: ExtensionConfigDiagnostic): unknown {
  if (diagnostic.kind === "invalid-schema") {
    return {
      kind: diagnostic.kind,
      path: diagnostic.path,
      namespace: diagnostic.namespace,
      message: diagnostic.message,
      errors: diagnostic.errors,
    };
  }
  if (diagnostic.kind === "merge-failed") {
    return {
      kind: diagnostic.kind,
      path: diagnostic.path,
      namespace: diagnostic.namespace,
      message: diagnostic.message,
      cause: diagnostic.cause.message,
    };
  }
  return {
    kind: diagnostic.kind,
    path: diagnostic.path,
    message: diagnostic.message,
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
        message: `Failed to read extension config: ${file}`,
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
        message: `Failed to parse extension config JSON: ${file}: ${causeMessage(parsed.error)}`,
        cause: parsed.error,
      },
    };
  }

  if (!Value.Check(JsonMapSchema, parsed.value)) {
    return {
      path: file,
      value: undefined,
      diagnostic: {
        kind: "invalid-root",
        path: file,
        message: `Extension config root must be a JSON object: ${file}`,
      },
    };
  }

  return { path: file, value: Value.Decode(JsonMapSchema, parsed.value) };
}

function schemaErrors(schema: TSchema, value: unknown): readonly string[] {
  return Array.from(Value.Errors(schema, value), (error) => error.message);
}

async function mergeConfigModule<Config, Schema extends TSchema>(input: {
  readonly module: RegisterConfigInput<Config, Schema>;
  readonly current: Config;
  readonly patch: unknown;
  readonly file: string;
}): Promise<
  | { readonly status: "applied"; readonly value: Config }
  | { readonly status: "skipped"; readonly diagnostic: ExtensionConfigDiagnostic }
> {
  if (!Value.Check(input.module.schema, input.patch)) {
    const errors = schemaErrors(input.module.schema, input.patch);
    return {
      status: "skipped",
      diagnostic: {
        kind: "invalid-schema",
        path: input.file,
        namespace: input.module.namespace,
        message: `Invalid extension config for namespace "${input.module.namespace}" in ${input.file}`,
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
        message: `Failed to merge extension config for namespace "${input.module.namespace}" in ${input.file}`,
        cause: merged.error,
      },
    };
  }

  return { status: "applied", value: merged.value };
}

interface ConfigModuleState<Config> {
  readonly value: Config;
  readonly loadedFrom: readonly string[];
  readonly diagnostics: readonly ExtensionConfigDiagnostic[];
}

async function applyConfigFiles<Config, Schema extends TSchema>(input: {
  readonly input: RegisterConfigInput<Config, Schema>;
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
  readonly diagnostics: readonly ExtensionConfigDiagnostic[];
}

export async function loadConfig(
  input: LoadConfigInput,
): Promise<ExtensionConfigLoadResult<LoadedExtensionConfig>> {
  const registry = ConfigRegistry.create({ cwd: input.cwd });
  if (Result.isError(registry)) return Result.err(registry.error);

  for (const module of input.modules) {
    const registered = registry.value.register(module);
    if (Result.isError(registered)) return Result.err(registered.error);
  }

  return registry.value.load();
}

async function loadConfigModules(
  input: LoadConfigInput,
): Promise<ExtensionConfigLoadResult<LoadedExtensionConfig>> {
  const paths = resolveExtensionConfigPaths(input.cwd);
  const files = [
    await readConfigFile(paths.globalConfigFile),
    await readConfigFile(paths.projectConfigFile),
  ];
  const fileDiagnostics = files
    .map((file) => file.diagnostic)
    .filter((diagnostic): diagnostic is ExtensionConfigDiagnostic => diagnostic !== undefined);

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
