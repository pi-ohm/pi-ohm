import fs from "node:fs/promises";
import path from "node:path";
import { Result } from "better-result";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { resolveOhmAgentDataHome } from "@pi-ohm/core/paths";
import { ReferencesError } from "./repository";

export type PackageRegistry = "npm" | "jsr";

export interface PackageReference {
  readonly type: "package";
  readonly registry: PackageRegistry;
  readonly package: string;
  readonly version: string;
  readonly spec: string;
  readonly label: string;
}

export interface PackageCacheResult {
  readonly registry: PackageRegistry;
  readonly package: string;
  readonly version: string;
  readonly localPath: string;
  readonly status: "cached" | "packed" | "refreshed";
  readonly freshness: "fresh" | "unknown";
  readonly resolvedVersion?: string;
}

export interface PackageExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface PackageExecHost {
  exec(
    command: string,
    args: string[],
    options?: { readonly cwd?: string; readonly timeout?: number; readonly signal?: AbortSignal },
  ): Promise<PackageExecResult>;
}

export interface EnsurePackageInput {
  readonly pi: PackageExecHost;
  readonly reference: PackageReference;
  readonly refresh?: boolean;
  readonly signal?: AbortSignal;
  readonly root?: string;
}

const PACK_TIMEOUT_MS = 120_000;
const LOCK_TIMEOUT_MS = 120_000;
const LOCK_POLL_MS = 100;
const NULL_CHAR = String.fromCharCode(0);
const PackEntriesSchema = Type.Array(
  Type.Object(
    {
      filename: Type.String(),
      version: Type.Optional(Type.String()),
    },
    { additionalProperties: true },
  ),
);

type PackEntries = ReturnType<typeof Value.Decode<typeof PackEntriesSchema>>;

function error(input: ConstructorParameters<typeof ReferencesError>[0]): ReferencesError {
  return new ReferencesError(input);
}

function causeMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (typeof cause === "string" && cause.trim().length > 0) return cause;
  return String(cause);
}

function cacheError(input: {
  readonly code: "cache_operation_failed" | "package_command_failed" | "invalid_package";
  readonly message: string;
  readonly path?: string;
  readonly packageName?: string;
  readonly registry?: PackageRegistry;
  readonly cause?: unknown;
}): ReferencesError {
  return error({
    code: input.code,
    message: input.message,
    ...(input.path ? { path: input.path } : {}),
    ...(input.packageName ? { packageName: input.packageName } : {}),
    ...(input.registry ? { registry: input.registry } : {}),
    ...(input.cause ? { cause: input.cause } : {}),
  });
}

function invalidPackage(input: string, message: string): ReferencesError {
  return cacheError({
    code: "invalid_package",
    message,
    packageName: input,
  });
}

function trim(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function safeNameSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes(NULL_CHAR) &&
    !/[\s\\/:]/u.test(segment)
  );
}

function safeVersion(version: string): boolean {
  return version.length > 0 && !version.includes(NULL_CHAR) && !/[\\/]/u.test(version);
}

function normalizeRegistry(registry: string | undefined): Result<PackageRegistry, ReferencesError> {
  if (registry === undefined || registry === "npm") return Result.ok("npm");
  if (registry === "jsr") return Result.ok("jsr");
  return Result.err(invalidPackage(registry, `Unsupported package registry: ${registry}`));
}

function splitScopedPackage(
  spec: string,
): Result<{ readonly name: string; readonly version?: string }, ReferencesError> {
  const slash = spec.indexOf("/");
  if (slash <= 1)
    return Result.err(invalidPackage(spec, "Scoped package must look like @scope/name"));

  const scope = spec.slice(0, slash);
  const rest = spec.slice(slash + 1);
  const versionIndex = rest.indexOf("@");
  const packageName = versionIndex === -1 ? rest : rest.slice(0, versionIndex);
  const version = versionIndex === -1 ? undefined : rest.slice(versionIndex + 1).trim();
  if (packageName.includes("/")) {
    return Result.err(invalidPackage(spec, "Package subpaths are not supported"));
  }
  if (!safeNameSegment(scope.slice(1)) || !safeNameSegment(packageName)) {
    return Result.err(invalidPackage(spec, "Invalid scoped package name"));
  }
  if (version !== undefined && !safeVersion(version)) {
    return Result.err(invalidPackage(spec, "Invalid package version"));
  }
  return Result.ok({
    name: `${scope}/${packageName}`,
    ...(version ? { version } : {}),
  });
}

function splitUnscopedPackage(
  spec: string,
): Result<{ readonly name: string; readonly version?: string }, ReferencesError> {
  const versionIndex = spec.indexOf("@");
  const packageName = versionIndex === -1 ? spec : spec.slice(0, versionIndex);
  const version = versionIndex === -1 ? undefined : spec.slice(versionIndex + 1).trim();
  if (packageName.includes("/")) {
    return Result.err(invalidPackage(spec, "Package subpaths are not supported"));
  }
  if (!safeNameSegment(packageName))
    return Result.err(invalidPackage(spec, "Invalid package name"));
  if (version !== undefined && !safeVersion(version)) {
    return Result.err(invalidPackage(spec, "Invalid package version"));
  }
  return Result.ok({
    name: packageName,
    ...(version ? { version } : {}),
  });
}

function splitPackageSpec(
  spec: string,
): Result<{ readonly name: string; readonly version?: string }, ReferencesError> {
  const cleaned = trim(spec);
  if (!cleaned) return Result.err(invalidPackage(spec, "Package spec cannot be empty"));
  if (cleaned.startsWith("@")) return splitScopedPackage(cleaned);
  return splitUnscopedPackage(cleaned);
}

function packageSpec(input: { readonly packageName: string; readonly version: string }): string {
  return `${input.packageName}@${input.version}`;
}

function buildPackageReference(input: {
  readonly registry: PackageRegistry;
  readonly packageName: string;
  readonly version?: string;
}): Result<PackageReference, ReferencesError> {
  const parsed = splitPackageSpec(input.packageName);
  if (Result.isError(parsed)) return Result.err(parsed.error);
  const version = trim(input.version ?? parsed.value.version ?? "latest");
  if (!version || !safeVersion(version)) {
    return Result.err(invalidPackage(input.version ?? "", "Invalid package version"));
  }
  const label = `${input.registry}:${packageSpec({ packageName: parsed.value.name, version })}`;
  return Result.ok({
    type: "package",
    registry: input.registry,
    package: parsed.value.name,
    version,
    spec: packageSpec({ packageName: parsed.value.name, version }),
    label,
  });
}

export function parsePackageReference(input: string): Result<PackageReference, ReferencesError> {
  const cleaned = trim(input);
  if (!cleaned) return Result.err(invalidPackage(input, "Package reference cannot be empty"));
  const match = cleaned.match(/^(npm|jsr):(.+)$/u);
  const registry = normalizeRegistry(match?.[1]);
  if (Result.isError(registry)) return Result.err(registry.error);
  const spec = match?.[2];
  if (!spec)
    return Result.err(invalidPackage(input, "Package reference must start with npm: or jsr:"));
  const parsed = splitPackageSpec(spec);
  if (Result.isError(parsed)) return Result.err(parsed.error);
  return buildPackageReference({
    registry: registry.value,
    packageName: parsed.value.name,
    version: parsed.value.version,
  });
}

export function parsePackageConfig(input: {
  readonly packageName: string;
  readonly registry?: string;
  readonly version?: string;
}): Result<PackageReference, ReferencesError> {
  const registry = normalizeRegistry(input.registry);
  if (Result.isError(registry)) return Result.err(registry.error);
  return buildPackageReference({
    registry: registry.value,
    packageName: input.packageName,
    ...(input.version ? { version: input.version } : {}),
  });
}

export function defaultPackageCacheRoot(): string {
  return path.join(resolveOhmAgentDataHome(), "references", "packages");
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%20", "+");
}

export function packageCachePath(root: string, reference: PackageReference): string {
  return path.join(
    root,
    reference.registry,
    ...reference.package.split("/"),
    encodeSegment(reference.version),
  );
}

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(
    () => true,
    () => false,
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fsOperation<T>(input: {
  readonly stage: string;
  readonly target: string;
  readonly run: () => Promise<T>;
}): Promise<Result<T, ReferencesError>> {
  return Result.tryPromise({
    try: input.run,
    catch: (cause) =>
      cacheError({
        code: "cache_operation_failed",
        path: input.target,
        message: `${input.stage} failed for ${input.target}: ${causeMessage(cause)}`,
        cause,
      }),
  });
}

function lockPath(target: string): string {
  return `${target}.lock`;
}

async function acquireLock(input: {
  readonly target: string;
  readonly deadline: number;
  readonly signal?: AbortSignal;
}): Promise<Result<string, ReferencesError>> {
  if (input.signal?.aborted) {
    return Result.err(
      cacheError({
        code: "cache_operation_failed",
        path: input.target,
        message: `Package cache lock wait aborted for ${input.target}`,
      }),
    );
  }

  const created = await Result.tryPromise({
    try: () => fs.mkdir(input.target),
    catch: (cause) => cause,
  });
  if (Result.isOk(created)) return Result.ok(input.target);
  if (Date.now() >= input.deadline) {
    return Result.err(
      cacheError({
        code: "cache_operation_failed",
        path: input.target,
        message: `Timed out waiting for package cache lock: ${input.target}`,
        cause: created.error,
      }),
    );
  }

  await wait(LOCK_POLL_MS);
  return acquireLock(input);
}

async function releaseLock(target: string): Promise<Result<void, ReferencesError>> {
  return fsOperation({
    stage: "release package cache lock",
    target,
    run: () => fs.rm(target, { recursive: true, force: true }),
  });
}

async function cleanup(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true }).then(
    () => undefined,
    () => undefined,
  );
}

async function withCleanup<T>(
  target: string,
  error: ReferencesError,
): Promise<Result<T, ReferencesError>> {
  await cleanup(target);
  return Result.err(error);
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

function parsePackOutput(
  stdout: string,
  packageName: string,
): Result<PackEntries[number], ReferencesError> {
  const parsed = Result.try({
    try: () => parseJson(stdout),
    catch: (cause) =>
      cacheError({
        code: "package_command_failed",
        packageName,
        message: `npm pack returned invalid JSON: ${causeMessage(cause)}`,
        cause,
      }),
  });
  if (Result.isError(parsed)) return Result.err(parsed.error);
  if (!Value.Check(PackEntriesSchema, parsed.value)) {
    return Result.err(
      cacheError({
        code: "package_command_failed",
        packageName,
        message: "npm pack returned an unexpected JSON shape",
      }),
    );
  }
  const entries = Value.Decode(PackEntriesSchema, parsed.value);
  const entry = entries[0];
  if (!entry) {
    return Result.err(
      cacheError({
        code: "package_command_failed",
        packageName,
        message: "npm pack did not return a package tarball",
      }),
    );
  }
  if (path.basename(entry.filename) !== entry.filename) {
    return Result.err(
      cacheError({
        code: "package_command_failed",
        packageName,
        message: "npm pack returned an unsafe tarball filename",
      }),
    );
  }
  return Result.ok(entry);
}

async function command(input: {
  readonly pi: PackageExecHost;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly packageName: string;
  readonly signal?: AbortSignal;
}): Promise<Result<PackageExecResult, ReferencesError>> {
  const result = await Result.tryPromise({
    try: () =>
      input.pi.exec(input.command, [...input.args], {
        cwd: input.cwd,
        timeout: PACK_TIMEOUT_MS,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    catch: (cause) =>
      cacheError({
        code: "package_command_failed",
        packageName: input.packageName,
        message: `${input.command} ${input.args.join(" ")} failed: ${causeMessage(cause)}`,
        cause,
      }),
  });
  if (Result.isError(result)) return result;
  if (result.value.code === 0) return result;
  return Result.err(
    cacheError({
      code: "package_command_failed",
      packageName: input.packageName,
      message:
        result.value.stderr.trim() ||
        result.value.stdout.trim() ||
        `${input.command} ${input.args.join(" ")} failed with exit code ${result.value.code}`,
    }),
  );
}

function uniqueTempPath(target: string): string {
  return `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function packIntoTemp(input: {
  readonly pi: PackageExecHost;
  readonly reference: PackageReference;
  readonly tempRoot: string;
  readonly signal?: AbortSignal;
}): Promise<
  Result<{ readonly extractRoot: string; readonly resolvedVersion?: string }, ReferencesError>
> {
  const packRoot = path.join(input.tempRoot, "pack");
  const extractRoot = path.join(input.tempRoot, "extract");
  const created = await fsOperation({
    stage: "create package temp directory",
    target: input.tempRoot,
    run: () => fs.mkdir(packRoot, { recursive: true }),
  });
  if (Result.isError(created)) return Result.err(created.error);

  const extractCreated = await fsOperation({
    stage: "create package extract directory",
    target: extractRoot,
    run: () => fs.mkdir(extractRoot, { recursive: true }),
  });
  if (Result.isError(extractCreated)) return Result.err(extractCreated.error);

  if (input.reference.registry !== "npm") {
    return Result.err(
      cacheError({
        code: "package_command_failed",
        packageName: input.reference.package,
        registry: input.reference.registry,
        message: `Package registry is not supported yet: ${input.reference.registry}`,
      }),
    );
  }

  const packed = await command({
    pi: input.pi,
    command: "npm",
    args: [
      "pack",
      input.reference.spec,
      "--json",
      "--pack-destination",
      packRoot,
      "--ignore-scripts",
    ],
    cwd: packRoot,
    packageName: input.reference.package,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (Result.isError(packed)) return Result.err(packed.error);

  const pack = parsePackOutput(packed.value.stdout, input.reference.package);
  if (Result.isError(pack)) return Result.err(pack.error);
  const tarball = path.join(packRoot, pack.value.filename);
  const extracted = await command({
    pi: input.pi,
    command: "tar",
    args: ["-xzf", tarball, "-C", extractRoot, "--strip-components", "1"],
    cwd: input.tempRoot,
    packageName: input.reference.package,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (Result.isError(extracted)) return Result.err(extracted.error);

  return Result.ok({
    extractRoot,
    ...(pack.value.version ? { resolvedVersion: pack.value.version } : {}),
  });
}

async function ensurePackageCache(input: {
  readonly pi: PackageExecHost;
  readonly reference: PackageReference;
  readonly localPath: string;
  readonly refresh?: boolean;
  readonly signal?: AbortSignal;
}): Promise<Result<PackageCacheResult, ReferencesError>> {
  const existsAlready = await exists(path.join(input.localPath, "package.json"));
  if (existsAlready && !input.refresh) {
    return Result.ok({
      registry: input.reference.registry,
      package: input.reference.package,
      version: input.reference.version,
      localPath: input.localPath,
      status: "cached",
      freshness: "unknown",
    });
  }

  const parent = await fsOperation({
    stage: "create package cache parent",
    target: path.dirname(input.localPath),
    run: () => fs.mkdir(path.dirname(input.localPath), { recursive: true }),
  });
  if (Result.isError(parent)) return Result.err(parent.error);

  const tempRoot = uniqueTempPath(input.localPath);
  const packed = await packIntoTemp({
    pi: input.pi,
    reference: input.reference,
    tempRoot,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (Result.isError(packed)) return withCleanup(tempRoot, packed.error);

  const removed = await fsOperation({
    stage: "remove old package cache",
    target: input.localPath,
    run: () => fs.rm(input.localPath, { recursive: true, force: true }),
  });
  if (Result.isError(removed)) return withCleanup(tempRoot, removed.error);

  const moved = await fsOperation({
    stage: "move package cache into place",
    target: input.localPath,
    run: () => fs.rename(packed.value.extractRoot, input.localPath),
  });
  if (Result.isError(moved)) return withCleanup(tempRoot, moved.error);
  await cleanup(tempRoot);

  return Result.ok({
    registry: input.reference.registry,
    package: input.reference.package,
    version: input.reference.version,
    localPath: input.localPath,
    status: existsAlready ? "refreshed" : "packed",
    freshness: "fresh",
    ...(packed.value.resolvedVersion ? { resolvedVersion: packed.value.resolvedVersion } : {}),
  });
}

export async function ensurePackage(
  input: EnsurePackageInput,
): Promise<Result<PackageCacheResult, ReferencesError>> {
  const root = input.root ?? defaultPackageCacheRoot();
  const localPath = packageCachePath(root, input.reference);
  const parent = await fsOperation({
    stage: "create package cache parent",
    target: path.dirname(localPath),
    run: () => fs.mkdir(path.dirname(localPath), { recursive: true }),
  });
  if (Result.isError(parent)) return Result.err(parent.error);

  const lock = await acquireLock({
    target: lockPath(localPath),
    deadline: Date.now() + LOCK_TIMEOUT_MS,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (Result.isError(lock)) return Result.err(lock.error);

  const result = await ensurePackageCache({
    pi: input.pi,
    reference: input.reference,
    localPath,
    ...(input.refresh ? { refresh: input.refresh } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const released = await releaseLock(lock.value);
  if (Result.isError(result)) return Result.err(result.error);
  if (Result.isError(released)) return Result.err(released.error);
  return result;
}
