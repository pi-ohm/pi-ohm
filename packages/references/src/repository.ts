import path from "node:path";
import { fileURLToPath } from "node:url";
import { Result, TaggedError } from "better-result";

export type ReferenceErrorCode =
  | "invalid_repository"
  | "unsupported_file_repository"
  | "invalid_branch"
  | "cache_operation_failed"
  | "git_command_failed";

export class ReferencesError extends TaggedError("ReferencesError")<{
  readonly code: ReferenceErrorCode;
  readonly message: string;
  readonly repository?: string;
  readonly branch?: string;
  readonly path?: string;
  readonly cause?: unknown;
}>() {}

interface BaseRepositoryReference {
  readonly host: string;
  readonly path: string;
  readonly segments: readonly string[];
  readonly owner?: string;
  readonly repo: string;
  readonly remote: string;
  readonly label: string;
}

export interface RemoteRepositoryReference extends BaseRepositoryReference {
  readonly type: "remote";
  readonly protocol?: string;
}

export interface FileRepositoryReference extends BaseRepositoryReference {
  readonly type: "file";
  readonly host: "file";
  readonly protocol: "file:";
}

export type RepositoryReference = RemoteRepositoryReference | FileRepositoryReference;

function error(input: ConstructorParameters<typeof ReferencesError>[0]): ReferencesError {
  return new ReferencesError(input);
}

function normalizeInput(input: string): string {
  return input
    .trim()
    .replace(/^git\+/, "")
    .replace(/#.*$/, "")
    .replace(/\/+$/, "");
}

function trimGitSuffix(input: string): string {
  return input.replace(/\.git$/, "");
}

function parts(input: string): readonly string[] {
  return input
    .split("/")
    .map((item) => trimGitSuffix(item.trim()))
    .filter((item) => item.length > 0);
}

function safeHost(input: string): boolean {
  return input.length > 0 && !input.startsWith("-") && !/[\s/\\]/.test(input);
}

function safeSegment(input: string): boolean {
  return input !== "." && input !== ".." && !input.includes(":") && !/[\s/\\]/.test(input);
}

function hostLike(input: string): boolean {
  return input.includes(".") || input.includes(":") || input === "localhost";
}

function withSlash(input: string): string {
  if (input.endsWith("/")) return input;
  return `${input}/`;
}

function githubRemote(pathname: string): string {
  const base = process.env.OPENCODE_REPO_CLONE_GITHUB_BASE_URL;
  if (!base) return `https://github.com/${pathname}.git`;
  return new URL(`${pathname}.git`, withSlash(base)).href;
}

function invalidRepository(repository: string): ReferencesError {
  return error({
    code: "invalid_repository",
    repository,
    message: "Repository must be a git URL, host/path reference, or GitHub owner/repo shorthand",
  });
}

function buildRemote(input: {
  readonly host: string;
  readonly segments: readonly string[];
  readonly remote?: string;
  readonly protocol?: string;
}): Result<RemoteRepositoryReference, ReferencesError> {
  const segments = input.segments.map(trimGitSuffix).filter((segment) => segment.length > 0);
  if (
    !safeHost(input.host) ||
    segments.length === 0 ||
    segments.some((segment) => !safeSegment(segment))
  ) {
    return Result.err(invalidRepository(input.remote ?? input.host));
  }

  const repositoryPath = segments.join("/");
  const host = input.host.toLowerCase();
  const repo = segments.at(-1);
  if (!repo) return Result.err(invalidRepository(input.remote ?? input.host));

  return Result.ok({
    type: "remote",
    host,
    path: repositoryPath,
    segments,
    ...(segments.length === 2 ? { owner: segments[0] } : {}),
    repo,
    remote:
      input.remote ??
      (host === "github.com"
        ? githubRemote(repositoryPath)
        : `https://${host}/${repositoryPath}.git`),
    label:
      host === "github.com" && segments.length === 2 ? repositoryPath : `${host}/${repositoryPath}`,
    ...(input.protocol ? { protocol: input.protocol } : {}),
  });
}

function buildFile(input: {
  readonly url: URL;
  readonly remote: string;
}): Result<FileRepositoryReference, ReferencesError> {
  const filePath = path.normalize(fileURLToPath(input.url));
  const segments = filePath.split(/[\\/]+/).filter((segment) => segment.length > 0);
  const repo = segments.at(-1);
  if (!repo) return Result.err(invalidRepository(input.remote));

  return Result.ok({
    type: "file",
    host: "file",
    path: filePath,
    segments: segments.map((segment) => segment.replace(/:$/, "")),
    repo: trimGitSuffix(repo),
    remote: input.remote,
    label: filePath,
    protocol: "file:",
  });
}

export function parseRepositoryReference(
  input: string,
): Result<RepositoryReference, ReferencesError> {
  const cleaned = normalizeInput(input);
  if (cleaned.length === 0) return Result.err(invalidRepository(input));

  const githubPrefixed = cleaned.match(/^github:([^/\s]+)\/([^/\s]+)$/);
  const githubOwner = githubPrefixed?.[1];
  const githubRepo = githubPrefixed?.[2];
  if (githubOwner && githubRepo) {
    return buildRemote({ host: "github.com", segments: [githubOwner, githubRepo] });
  }

  if (!cleaned.includes("://")) {
    const scp = cleaned.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/);
    const scpHost = scp?.[1];
    const scpPath = scp?.[2];
    if (scpHost && scpPath) {
      return buildRemote({ host: scpHost, segments: parts(scpPath), remote: cleaned });
    }

    const direct = parts(cleaned);
    const first = direct[0];
    if (direct.length >= 2 && first && hostLike(first)) {
      return buildRemote({ host: first, segments: direct.slice(1) });
    }
    if (direct.length === 2) return buildRemote({ host: "github.com", segments: direct });
  }

  const parsed = Result.try({
    try: () => new URL(cleaned),
    catch: (cause) => cause,
  });
  if (Result.isError(parsed)) return Result.err(invalidRepository(input));

  if (parsed.value.protocol === "file:") return buildFile({ url: parsed.value, remote: cleaned });

  const segments = parts(parsed.value.pathname);
  return buildRemote({
    host: parsed.value.host,
    segments,
    remote: parsed.value.host === "github.com" ? githubRemote(segments.join("/")) : cleaned,
    protocol: parsed.value.protocol,
  });
}

export function parseRemoteRepositoryReference(
  input: string,
): Result<RemoteRepositoryReference, ReferencesError> {
  const reference = parseRepositoryReference(input);
  if (Result.isError(reference)) return Result.err(reference.error);
  if (reference.value.type === "remote") return Result.ok(reference.value);

  return Result.err(
    error({
      code: "unsupported_file_repository",
      repository: input,
      message: "Local file repositories are not supported through repository; use path instead",
    }),
  );
}

export function validateBranch(branch: string): Result<string, ReferencesError> {
  if (/^[A-Za-z0-9/_.-]+$/.test(branch) && !branch.startsWith("-") && !branch.includes("..")) {
    return Result.ok(branch);
  }

  return Result.err(
    error({
      code: "invalid_branch",
      branch,
      message:
        "Branch must contain only alphanumeric characters, /, _, ., and -, and cannot start with - or contain ..",
    }),
  );
}

export function repositoryCachePath(root: string, reference: RepositoryReference): string {
  return path.join(root, ...reference.host.split(":"), ...reference.segments);
}

export function repositoryCacheIdentity(reference: RepositoryReference): string {
  return `${reference.host}/${reference.path}`;
}

export function sameRepositoryReference(
  left: RepositoryReference,
  right: RepositoryReference,
): boolean {
  return repositoryCacheIdentity(left) === repositoryCacheIdentity(right);
}
