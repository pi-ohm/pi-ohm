import fs from "node:fs/promises";
import path from "node:path";
import { Result } from "better-result";
import type { ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveOhmAgentDataHome } from "@pi-ohm/core/paths";
import {
  ReferencesError,
  parseRepositoryReference,
  repositoryCachePath,
  sameRepositoryReference,
  validateBranch,
  type RepositoryReference,
  type RemoteRepositoryReference,
} from "./repository";

export interface RepositoryCacheResult {
  readonly repository: string;
  readonly host: string;
  readonly remote: string;
  readonly localPath: string;
  readonly status: "cached" | "cloned" | "refreshed";
  readonly freshness: "fresh" | "unknown";
  readonly head?: string;
  readonly remoteHead?: string;
  readonly branch?: string;
}

export interface EnsureRepositoryInput {
  readonly pi: Pick<ExtensionAPI, "exec">;
  readonly reference: RemoteRepositoryReference;
  readonly branch?: string;
  readonly refresh?: boolean;
  readonly signal?: AbortSignal;
  readonly root?: string;
}

const GIT_TIMEOUT_MS = 120_000;
const GIT_REMOTE_CHECK_TIMEOUT_MS = 15_000;
const CACHE_LOCK_TIMEOUT_MS = 120_000;
const CACHE_LOCK_POLL_MS = 100;

export function defaultReferencesCacheRoot(): string {
  return path.join(resolveOhmAgentDataHome(), "references", "repos");
}

function causeMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (typeof cause === "string" && cause.trim().length > 0) return cause;
  return String(cause);
}

function causeCode(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return undefined;
  const code = Reflect.get(cause, "code");
  if (typeof code !== "string") return undefined;
  return code;
}

function cacheError(input: {
  readonly code: "cache_operation_failed" | "git_command_failed";
  readonly message: string;
  readonly path?: string;
  readonly repository?: string;
  readonly cause?: unknown;
}): ReferencesError {
  return new ReferencesError(input);
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

async function cacheOperation<T>(input: {
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

interface RepositoryCacheLock {
  readonly path: string;
}

function lockPath(target: string): string {
  return `${target}.lock`;
}

function abortedLockError(target: string): ReferencesError {
  return cacheError({
    code: "cache_operation_failed",
    path: target,
    message: `Repository cache lock wait aborted for ${target}`,
  });
}

async function acquireRepositoryLock(input: {
  readonly target: string;
  readonly signal?: AbortSignal;
  readonly deadline: number;
}): Promise<Result<RepositoryCacheLock, ReferencesError>> {
  if (input.signal?.aborted) return Result.err(abortedLockError(input.target));

  const created = await Result.tryPromise({
    try: () => fs.mkdir(input.target),
    catch: (cause) => cause,
  });
  if (Result.isOk(created)) return Result.ok({ path: input.target });
  if (causeCode(created.error) !== "EEXIST") {
    return Result.err(
      cacheError({
        code: "cache_operation_failed",
        path: input.target,
        message: `Acquire repository cache lock failed for ${input.target}: ${causeMessage(created.error)}`,
        cause: created.error,
      }),
    );
  }
  if (Date.now() >= input.deadline) {
    return Result.err(
      cacheError({
        code: "cache_operation_failed",
        path: input.target,
        message: `Timed out waiting for repository cache lock: ${input.target}`,
        cause: created.error,
      }),
    );
  }

  await wait(CACHE_LOCK_POLL_MS);
  return acquireRepositoryLock(input);
}

async function releaseRepositoryLock(
  lock: RepositoryCacheLock,
): Promise<Result<void, ReferencesError>> {
  return cacheOperation({
    stage: "release repository cache lock",
    target: lock.path,
    run: () => fs.rm(lock.path, { recursive: true, force: true }),
  });
}

async function withRepositoryLock<T>(input: {
  readonly target: string;
  readonly signal?: AbortSignal;
  readonly run: () => Promise<Result<T, ReferencesError>>;
}): Promise<Result<T, ReferencesError>> {
  const lock = await acquireRepositoryLock({
    target: lockPath(input.target),
    ...(input.signal ? { signal: input.signal } : {}),
    deadline: Date.now() + CACHE_LOCK_TIMEOUT_MS,
  });
  if (Result.isError(lock)) return Result.err(lock.error);

  const result = await Result.tryPromise({
    try: input.run,
    catch: (cause) =>
      cacheError({
        code: "cache_operation_failed",
        path: input.target,
        message: `Repository cache operation failed for ${input.target}: ${causeMessage(cause)}`,
        cause,
      }),
  });
  const released = await releaseRepositoryLock(lock.value);
  if (Result.isError(result)) return Result.err(result.error);
  if (Result.isError(result.value)) return Result.err(result.value.error);
  if (Result.isError(released)) return Result.err(released.error);
  return Result.ok(result.value.value);
}

async function git(input: {
  readonly pi: Pick<ExtensionAPI, "exec">;
  readonly cwd: string;
  readonly args: readonly string[];
  readonly repository?: string;
  readonly signal?: AbortSignal;
}): Promise<Result<ExecResult, ReferencesError>> {
  const result = await Result.tryPromise({
    try: () =>
      input.pi.exec("git", [...input.args], {
        cwd: input.cwd,
        timeout: GIT_TIMEOUT_MS,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    catch: (cause) =>
      cacheError({
        code: "git_command_failed",
        repository: input.repository,
        message: `git ${input.args.join(" ")} failed: ${causeMessage(cause)}`,
        cause,
      }),
  });
  if (Result.isError(result)) return result;
  if (result.value.code === 0) return result;

  return Result.err(
    cacheError({
      code: "git_command_failed",
      repository: input.repository,
      message:
        result.value.stderr.trim() ||
        result.value.stdout.trim() ||
        `git ${input.args.join(" ")} failed with exit code ${result.value.code}`,
    }),
  );
}

async function gitOptional(input: {
  readonly pi: Pick<ExtensionAPI, "exec">;
  readonly cwd: string;
  readonly args: readonly string[];
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): Promise<string | undefined> {
  const result = await Result.tryPromise({
    try: () =>
      input.pi.exec("git", [...input.args], {
        cwd: input.cwd,
        timeout: input.timeoutMs ?? GIT_TIMEOUT_MS,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    catch: (cause) => cause,
  });
  if (Result.isError(result)) return undefined;
  if (result.value.code !== 0) return undefined;
  const trimmed = result.value.stdout.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function statusForRepository(input: {
  readonly reuse: boolean;
  readonly branchMatches?: boolean;
  readonly head?: string;
  readonly remoteHead?: string;
}): "cached" | "cloned" | "refreshed" {
  if (!input.reuse) return "cloned";
  if (input.branchMatches === false) return "refreshed";
  if (input.head && input.remoteHead && input.head !== input.remoteHead) return "refreshed";
  return "cached";
}

function parseLsRemoteHead(output: string): string | undefined {
  const line = output
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.length > 0 && !item.startsWith("ref:"));
  const sha = line?.split(/\s+/)[0];
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) return undefined;
  return sha;
}

async function remoteHead(input: {
  readonly pi: Pick<ExtensionAPI, "exec">;
  readonly cwd: string;
  readonly remote: string;
  readonly branch?: string;
  readonly signal?: AbortSignal;
}): Promise<string | undefined> {
  const output = await gitOptional({
    pi: input.pi,
    cwd: input.cwd,
    args: input.branch
      ? ["ls-remote", "--heads", input.remote, input.branch]
      : ["ls-remote", input.remote, "HEAD"],
    signal: input.signal,
    timeoutMs: GIT_REMOTE_CHECK_TIMEOUT_MS,
  });
  if (!output) return undefined;
  return parseLsRemoteHead(output);
}

async function resetTarget(input: {
  readonly pi: Pick<ExtensionAPI, "exec">;
  readonly cwd: string;
  readonly branch?: string;
  readonly signal?: AbortSignal;
}): Promise<string> {
  if (input.branch) return `origin/${input.branch}`;

  const remoteHead = await gitOptional({
    pi: input.pi,
    cwd: input.cwd,
    args: ["symbolic-ref", "refs/remotes/origin/HEAD"],
    signal: input.signal,
  });
  if (remoteHead) return remoteHead.replace(/^refs\/remotes\//, "");

  const branch = await gitOptional({
    pi: input.pi,
    cwd: input.cwd,
    args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
    signal: input.signal,
  });
  if (branch) return `origin/${branch}`;

  return "HEAD";
}

async function ensureRepositoryCache(input: {
  readonly pi: Pick<ExtensionAPI, "exec">;
  readonly reference: RemoteRepositoryReference;
  readonly cloneTarget: RepositoryReference;
  readonly repository: string;
  readonly localPath: string;
  readonly branch?: string;
  readonly refresh?: boolean;
  readonly signal?: AbortSignal;
}): Promise<Result<RepositoryCacheResult, ReferencesError>> {
  const pathExists = await exists(input.localPath);
  const hasGitDir = await exists(path.join(input.localPath, ".git"));
  const origin = hasGitDir
    ? await gitOptional({
        pi: input.pi,
        cwd: input.localPath,
        args: ["config", "--get", "remote.origin.url"],
        signal: input.signal,
      })
    : undefined;
  const originReference = origin ? parseRepositoryReference(origin) : undefined;
  const reuse =
    hasGitDir &&
    originReference !== undefined &&
    Result.isOk(originReference) &&
    sameRepositoryReference(originReference.value, input.cloneTarget);

  if (pathExists && !reuse) {
    const removed = await cacheOperation({
      stage: "remove stale repository cache",
      target: input.localPath,
      run: () => fs.rm(input.localPath, { recursive: true, force: true }),
    });
    if (Result.isError(removed)) return Result.err(removed.error);
  }

  const currentBranch = reuse
    ? await gitOptional({
        pi: input.pi,
        cwd: input.localPath,
        args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
        signal: input.signal,
      })
    : undefined;
  const currentHead = reuse
    ? await gitOptional({
        pi: input.pi,
        cwd: input.localPath,
        args: ["rev-parse", "HEAD"],
        signal: input.signal,
      })
    : undefined;
  const checkedRemoteHead =
    reuse && input.refresh
      ? await remoteHead({
          pi: input.pi,
          cwd: input.localPath,
          remote: input.reference.remote,
          branch: input.branch,
          ...(input.signal ? { signal: input.signal } : {}),
        })
      : undefined;
  const status = statusForRepository({
    reuse,
    head: currentHead,
    remoteHead: checkedRemoteHead,
    ...(input.branch ? { branchMatches: currentBranch === input.branch } : {}),
  });

  if (status === "cloned") {
    const cloned = await git({
      pi: input.pi,
      cwd: path.dirname(input.localPath),
      args: [
        "clone",
        "--depth",
        "100",
        ...(input.branch ? ["--branch", input.branch] : []),
        "--",
        input.reference.remote,
        input.localPath,
      ],
      repository: input.repository,
      signal: input.signal,
    });
    if (Result.isError(cloned)) return Result.err(cloned.error);
  }

  if (status === "refreshed") {
    const fetched = await git({
      pi: input.pi,
      cwd: input.localPath,
      args: ["fetch", "--all", "--prune"],
      repository: input.repository,
      signal: input.signal,
    });
    if (Result.isError(fetched)) return Result.err(fetched.error);

    if (input.branch) {
      const branchFetched = await git({
        pi: input.pi,
        cwd: input.localPath,
        args: [
          "fetch",
          "origin",
          `+refs/heads/${input.branch}:refs/remotes/origin/${input.branch}`,
        ],
        repository: input.repository,
        signal: input.signal,
      });
      if (Result.isError(branchFetched)) return Result.err(branchFetched.error);

      const checkedOut = await git({
        pi: input.pi,
        cwd: input.localPath,
        args: ["checkout", "-B", input.branch, `origin/${input.branch}`],
        repository: input.repository,
        signal: input.signal,
      });
      if (Result.isError(checkedOut)) return Result.err(checkedOut.error);
    }

    const reset = await git({
      pi: input.pi,
      cwd: input.localPath,
      args: [
        "reset",
        "--hard",
        await resetTarget({
          pi: input.pi,
          cwd: input.localPath,
          branch: input.branch,
          ...(input.signal ? { signal: input.signal } : {}),
        }),
      ],
      repository: input.repository,
      signal: input.signal,
    });
    if (Result.isError(reset)) return Result.err(reset.error);
  }

  const head = await gitOptional({
    pi: input.pi,
    cwd: input.localPath,
    args: ["rev-parse", "HEAD"],
    signal: input.signal,
  });
  const branch = await gitOptional({
    pi: input.pi,
    cwd: input.localPath,
    args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
    signal: input.signal,
  });

  return Result.ok({
    repository: input.repository,
    host: input.reference.host,
    remote: input.reference.remote,
    localPath: input.localPath,
    status,
    freshness: head && checkedRemoteHead && head === checkedRemoteHead ? "fresh" : "unknown",
    ...(head ? { head } : {}),
    ...(checkedRemoteHead ? { remoteHead: checkedRemoteHead } : {}),
    ...(branch ? { branch } : {}),
  });
}

export async function ensureRepository(
  input: EnsureRepositoryInput,
): Promise<Result<RepositoryCacheResult, ReferencesError>> {
  if (input.branch) {
    const branch = validateBranch(input.branch);
    if (Result.isError(branch)) return Result.err(branch.error);
  }

  const root = input.root ?? defaultReferencesCacheRoot();
  const repository = input.reference.label;
  const localPath = repositoryCachePath(root, input.reference);
  const cloneTargetResult = parseRepositoryReference(input.reference.remote);
  const cloneTarget = Result.isOk(cloneTargetResult) ? cloneTargetResult.value : input.reference;

  const ensured = await cacheOperation({
    stage: "ensure repository cache directory",
    target: localPath,
    run: () => fs.mkdir(path.dirname(localPath), { recursive: true }),
  });
  if (Result.isError(ensured)) return Result.err(ensured.error);

  return withRepositoryLock({
    target: localPath,
    ...(input.signal ? { signal: input.signal } : {}),
    run: () =>
      ensureRepositoryCache({
        pi: input.pi,
        reference: input.reference,
        cloneTarget,
        repository,
        localPath,
        ...(input.branch ? { branch: input.branch } : {}),
        ...(input.refresh ? { refresh: input.refresh } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      }),
  });
}
