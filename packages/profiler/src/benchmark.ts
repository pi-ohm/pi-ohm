import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AuthStorage,
  createEventBus,
  createExtensionRuntime,
  DefaultPackageManager,
  type EventBus,
  ExtensionRunner,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type Extension,
  type ExtensionActions,
  type ExtensionContext,
  type ExtensionContextActions,
  type ExtensionRuntime,
  type LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import { Result, TaggedError, type Result as BetterResult } from "better-result";
import { resolveExtensionConfigDir } from "@pi-ohm/core/config";
import {
  createProfileReport,
  type ProfilePhase,
  type ProfileRecord,
  type ProfileReport,
} from "./report";

export class ProfilerError extends TaggedError("ProfilerError")<{
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}>() {}

export interface ProfilerClock {
  now(): number;
  date(): Date;
}

export interface ProfileStartupInput {
  readonly cwd: string;
  readonly agentDir?: string;
  readonly extraExtensions?: readonly string[];
  readonly paths?: readonly string[];
  readonly includeLifecycle?: boolean;
  readonly clock?: ProfilerClock;
}

interface LoadedExtensionSet {
  readonly extensions: readonly Extension[];
  readonly records: readonly ProfileRecord[];
  readonly runtime: ExtensionRuntime;
}

type LifecycleEvent =
  | { readonly type: "session_start"; readonly reason: "startup" }
  | { readonly type: "resources_discover"; readonly cwd: string; readonly reason: "startup" };
type LoadExtensionsFn = (
  paths: string[],
  cwd: string,
  eventBus?: EventBus,
  runtime?: ExtensionRuntime,
) => Promise<LoadExtensionsResult>;

const defaultClock: ProfilerClock = {
  now: () => performance.now(),
  date: () => new Date(),
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoadExtensionsFn(value: unknown): value is LoadExtensionsFn {
  return typeof value === "function";
}

async function resolveLoadExtensions(): Promise<BetterResult<LoadExtensionsFn, ProfilerError>> {
  const loaded = await Result.tryPromise({
    try: async () => {
      const index = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
      // Pi 0.79.4 ships loadExtensions internally but omits it from the root runtime export.
      const moduleUrl = pathToFileURL(
        path.join(path.dirname(index), "core", "extensions", "index.js"),
      );
      const module: unknown = await import(moduleUrl.href);
      if (!isRecord(module)) return undefined;
      const candidate = Reflect.get(module, "loadExtensions");
      if (!isLoadExtensionsFn(candidate)) return undefined;
      return candidate;
    },
    catch: (cause) =>
      new ProfilerError({
        code: "extension_loader_unavailable",
        message: "Pi extension loader is unavailable",
        cause,
      }),
  });

  if (Result.isError(loaded)) return Result.err(loaded.error);
  if (loaded.value) return Result.ok(loaded.value);

  return Result.err(
    new ProfilerError({
      code: "extension_loader_missing",
      message: "Pi extension loader does not expose loadExtensions",
    }),
  );
}

function message(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (typeof cause === "string" && cause.trim().length > 0) return cause;
  return String(cause);
}

function compactNodeModuleLabel(file: string): string | undefined {
  const parts = file.split(/[\\/]+/u);
  const index = parts.lastIndexOf("node_modules");
  if (index === -1) return undefined;

  const first = parts[index + 1];
  const second = parts[index + 2];
  if (!first) return undefined;
  if (first.startsWith("@") && second) return `${first}/${second}`;
  return first;
}

export function labelExtensionPath(file: string, cwd: string): string {
  const moduleLabel = compactNodeModuleLabel(file);
  if (moduleLabel) return moduleLabel;

  const relative = path.relative(cwd, file);
  if (relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }

  return path.basename(file) || file;
}

function unique(values: readonly string[]): readonly string[] {
  return values.reduce<string[]>(
    (items, value) => (items.includes(value) ? items : [...items, value]),
    [],
  );
}

async function resolveConfiguredExtensionPaths(input: {
  readonly cwd: string;
  readonly agentDir: string;
  readonly extraExtensions: readonly string[];
}): Promise<BetterResult<readonly string[], ProfilerError>> {
  const resolved = await Result.tryPromise({
    try: async () => {
      const settings = SettingsManager.create(input.cwd, input.agentDir);
      await settings.reload();
      const manager = new DefaultPackageManager({
        cwd: input.cwd,
        agentDir: input.agentDir,
        settingsManager: settings,
      });
      const configured = await manager.resolve(async () => "skip");
      const extra = await manager.resolveExtensionSources([...input.extraExtensions], {
        temporary: true,
      });
      const paths = [...extra.extensions, ...configured.extensions]
        .filter((resource) => resource.enabled)
        .map((resource) => resource.path);
      return unique(paths);
    },
    catch: (cause) =>
      new ProfilerError({
        code: "extension_resolve_failed",
        message: "Failed to resolve configured Pi extensions",
        cause,
      }),
  });

  if (Result.isError(resolved)) return Result.err(resolved.error);
  return Result.ok(resolved.value);
}

async function loadTimedExtensions(input: {
  readonly cwd: string;
  readonly paths: readonly string[];
  readonly clock: ProfilerClock;
}): Promise<BetterResult<LoadedExtensionSet, ProfilerError>> {
  const loadExtensions = await resolveLoadExtensions();
  if (Result.isError(loadExtensions)) return Result.err(loadExtensions.error);

  const eventBus = createEventBus();
  const runtime = createExtensionRuntime();
  const extensions: Extension[] = [];
  const records: ProfileRecord[] = [];

  for (const extensionPath of input.paths) {
    const start = input.clock.now();
    const loaded = await Result.tryPromise({
      try: async () => loadExtensions.value([extensionPath], input.cwd, eventBus, runtime),
      catch: (cause) =>
        new ProfilerError({
          code: "extension_load_threw",
          message: `Extension loader threw while loading ${extensionPath}`,
          cause,
        }),
    });
    const ms = input.clock.now() - start;
    const label = labelExtensionPath(extensionPath, input.cwd);

    if (Result.isError(loaded)) {
      records.push({
        phase: "load",
        path: extensionPath,
        label,
        ms,
        status: "error",
        error: loaded.error.message,
      });
      continue;
    }

    extensions.push(...loaded.value.extensions);
    const error = loaded.value.errors[0];
    records.push({
      phase: "load",
      path: extensionPath,
      label,
      ms,
      status: error ? "error" : "ok",
      error: error?.error,
    });
  }

  return Result.ok({ extensions, records, runtime });
}

function createActions(): ExtensionActions {
  return {
    sendMessage() {},
    sendUserMessage() {},
    appendEntry() {},
    setSessionName() {},
    getSessionName() {
      return undefined;
    },
    setLabel() {},
    getActiveTools() {
      return [];
    },
    getAllTools() {
      return [];
    },
    setActiveTools() {},
    refreshTools() {},
    getCommands() {
      return [];
    },
    setModel: async () => false,
    getThinkingLevel() {
      return "medium";
    },
    setThinkingLevel() {},
  };
}

function createContextActions(cwd: string): ExtensionContextActions {
  return {
    getModel() {
      return undefined;
    },
    isIdle() {
      return true;
    },
    isProjectTrusted() {
      return true;
    },
    getSignal() {
      return undefined;
    },
    abort() {},
    hasPendingMessages() {
      return false;
    },
    shutdown() {},
    getContextUsage() {
      return undefined;
    },
    compact() {},
    getSystemPrompt() {
      return "";
    },
    getSystemPromptOptions() {
      return { cwd };
    },
  };
}

function createProfilingContext(input: {
  readonly cwd: string;
  readonly loaded: LoadedExtensionSet;
  readonly clock: ProfilerClock;
}): { readonly ctx: ExtensionContext; readonly bindRecord: ProfileRecord } {
  const session = SessionManager.inMemory(input.cwd);
  const models = ModelRegistry.inMemory(AuthStorage.inMemory());
  const runner = new ExtensionRunner(
    [...input.loaded.extensions],
    input.loaded.runtime,
    input.cwd,
    session,
    models,
  );
  const start = input.clock.now();
  runner.bindCore(createActions(), createContextActions(input.cwd));
  const ms = input.clock.now() - start;

  return {
    ctx: runner.createContext(),
    bindRecord: {
      phase: "bind",
      path: "<pi-extension-runner>",
      label: "pi extension runner",
      ms,
      status: "ok",
    },
  };
}

async function measureLifecycleEvent(input: {
  readonly extensions: readonly Extension[];
  readonly ctx: ExtensionContext;
  readonly event: LifecycleEvent;
  readonly phase: ProfilePhase;
  readonly cwd: string;
  readonly clock: ProfilerClock;
}): Promise<readonly ProfileRecord[]> {
  const records: ProfileRecord[] = [];

  for (const extension of input.extensions) {
    const handlers = extension.handlers.get(input.event.type) ?? [];
    if (handlers.length === 0) continue;

    const start = input.clock.now();
    const failures: string[] = [];
    for (const handler of handlers) {
      const handled = await Result.tryPromise({
        try: async () => {
          await handler(input.event, input.ctx);
        },
        catch: (cause) => message(cause),
      });
      if (Result.isError(handled)) failures.push(handled.error);
    }

    records.push({
      phase: input.phase,
      path: extension.path,
      label: labelExtensionPath(extension.path, input.cwd),
      ms: input.clock.now() - start,
      status: failures.length > 0 ? "error" : "ok",
      handlers: handlers.length,
      error: failures.length > 0 ? failures.join("\n") : undefined,
    });
  }

  return records;
}

async function measureLifecycle(input: {
  readonly cwd: string;
  readonly loaded: LoadedExtensionSet;
  readonly clock: ProfilerClock;
}): Promise<readonly ProfileRecord[]> {
  const context = createProfilingContext(input);
  const session = await measureLifecycleEvent({
    extensions: input.loaded.extensions,
    ctx: context.ctx,
    event: { type: "session_start", reason: "startup" },
    phase: "session_start",
    cwd: input.cwd,
    clock: input.clock,
  });
  const resources = await measureLifecycleEvent({
    extensions: input.loaded.extensions,
    ctx: context.ctx,
    event: { type: "resources_discover", cwd: input.cwd, reason: "startup" },
    phase: "resources_discover",
    cwd: input.cwd,
    clock: input.clock,
  });

  return [context.bindRecord, ...session, ...resources];
}

export async function profileStartup(
  input: ProfileStartupInput,
): Promise<BetterResult<ProfileReport, ProfilerError>> {
  const clock = input.clock ?? defaultClock;
  const agentDir = input.agentDir ?? resolveExtensionConfigDir();
  const paths = input.paths
    ? Result.ok(unique(input.paths))
    : await resolveConfiguredExtensionPaths({
        cwd: input.cwd,
        agentDir,
        extraExtensions: input.extraExtensions ?? [],
      });
  if (Result.isError(paths)) return Result.err(paths.error);

  const loaded = await loadTimedExtensions({ cwd: input.cwd, paths: paths.value, clock });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const lifecycle =
    input.includeLifecycle === false
      ? []
      : await measureLifecycle({ cwd: input.cwd, loaded: loaded.value, clock });

  return Result.ok(
    createProfileReport({
      cwd: input.cwd,
      generatedAt: clock.date().toISOString(),
      records: [...loaded.value.records, ...lifecycle],
    }),
  );
}
