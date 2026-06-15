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
  type RemoteRepositoryReference,
} from "./repository";

export interface RepositoryCacheResult {
  readonly repository: string;
  readonly host: string;
  readonly remote: string;
  readonly localPath: string;
  readonly status: "cached" | "cloned" | "refreshed";
  readonly head?: string;
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

export function defaultReferencesCacheRoot(): string {
  return path.join(resolveOhmAgentDataHome(), "references", "repos");
}

function causeMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (typeof cause === "string" && cause.trim().length > 0) return cause;
  return String(cause);
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
}): Promise<string | undefined> {
  const result = await Result.tryPromise({
    try: () =>
      input.pi.exec("git", [...input.args], {
        cwd: input.cwd,
        timeout: GIT_TIMEOUT_MS,
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
  readonly refresh?: boolean;
  readonly branchMatches?: boolean;
}): "cached" | "cloned" | "refreshed" {
  if (!input.reuse) return "cloned";
  if (input.branchMatches === false || input.refresh) return "refreshed";
  return "cached";
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

  const pathExists = await exists(localPath);
  const hasGitDir = await exists(path.join(localPath, ".git"));
  const origin = hasGitDir
    ? await gitOptional({
        pi: input.pi,
        cwd: localPath,
        args: ["config", "--get", "remote.origin.url"],
        signal: input.signal,
      })
    : undefined;
  const originReference = origin ? parseRepositoryReference(origin) : undefined;
  const reuse =
    hasGitDir &&
    originReference !== undefined &&
    Result.isOk(originReference) &&
    sameRepositoryReference(originReference.value, cloneTarget);

  if (pathExists && !reuse) {
    const removed = await cacheOperation({
      stage: "remove stale repository cache",
      target: localPath,
      run: () => fs.rm(localPath, { recursive: true, force: true }),
    });
    if (Result.isError(removed)) return Result.err(removed.error);
  }

  const currentBranch = reuse
    ? await gitOptional({
        pi: input.pi,
        cwd: localPath,
        args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
        signal: input.signal,
      })
    : undefined;
  const status = statusForRepository({
    reuse,
    refresh: input.refresh,
    ...(input.branch ? { branchMatches: currentBranch === input.branch } : {}),
  });

  if (status === "cloned") {
    const cloned = await git({
      pi: input.pi,
      cwd: path.dirname(localPath),
      args: [
        "clone",
        "--depth",
        "100",
        ...(input.branch ? ["--branch", input.branch] : []),
        "--",
        input.reference.remote,
        localPath,
      ],
      repository,
      signal: input.signal,
    });
    if (Result.isError(cloned)) return Result.err(cloned.error);
  }

  if (status === "refreshed") {
    const fetched = await git({
      pi: input.pi,
      cwd: localPath,
      args: ["fetch", "--all", "--prune"],
      repository,
      signal: input.signal,
    });
    if (Result.isError(fetched)) return Result.err(fetched.error);

    if (input.branch) {
      const branchFetched = await git({
        pi: input.pi,
        cwd: localPath,
        args: [
          "fetch",
          "origin",
          `+refs/heads/${input.branch}:refs/remotes/origin/${input.branch}`,
        ],
        repository,
        signal: input.signal,
      });
      if (Result.isError(branchFetched)) return Result.err(branchFetched.error);

      const checkedOut = await git({
        pi: input.pi,
        cwd: localPath,
        args: ["checkout", "-B", input.branch, `origin/${input.branch}`],
        repository,
        signal: input.signal,
      });
      if (Result.isError(checkedOut)) return Result.err(checkedOut.error);
    }

    const reset = await git({
      pi: input.pi,
      cwd: localPath,
      args: [
        "reset",
        "--hard",
        await resetTarget({
          pi: input.pi,
          cwd: localPath,
          branch: input.branch,
          ...(input.signal ? { signal: input.signal } : {}),
        }),
      ],
      repository,
      signal: input.signal,
    });
    if (Result.isError(reset)) return Result.err(reset.error);
  }

  const head = await gitOptional({
    pi: input.pi,
    cwd: localPath,
    args: ["rev-parse", "HEAD"],
    signal: input.signal,
  });
  const branch = await gitOptional({
    pi: input.pi,
    cwd: localPath,
    args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
    signal: input.signal,
  });

  return Result.ok({
    repository,
    host: input.reference.host,
    remote: input.reference.remote,
    localPath,
    status,
    ...(head ? { head } : {}),
    ...(branch ? { branch } : {}),
  });
}
