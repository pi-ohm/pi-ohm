import os from "node:os";
import path from "node:path";
import { Result } from "better-result";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defaultReferencesCacheRoot, ensureRepository, type RepositoryCacheResult } from "./cache";
import type { ReferenceEntryConfig, ReferencesRuntimeConfig } from "./config";
import {
  parseRemoteRepositoryReference,
  repositoryCachePath,
  validateBranch,
  type ReferencesError,
} from "./repository";

export interface LocalReferenceSource {
  readonly type: "local";
  readonly path: string;
  readonly description?: string;
  readonly hidden?: boolean;
}

export interface GitReferenceSource {
  readonly type: "git";
  readonly repository: string;
  readonly branch?: string;
  readonly description?: string;
  readonly hidden?: boolean;
}

export type ReferenceSource = LocalReferenceSource | GitReferenceSource;

export interface ReferenceInfo {
  readonly name: string;
  readonly path: string;
  readonly description?: string;
  readonly hidden?: boolean;
  readonly source: ReferenceSource;
}

export interface ReferenceDiagnostic {
  readonly name: string;
  readonly message: string;
  readonly cause: ReferencesError;
}

export interface ResolvedReferences {
  readonly references: readonly ReferenceInfo[];
  readonly diagnostics: readonly ReferenceDiagnostic[];
}

export interface MaterializeReferencesResult {
  readonly results: readonly RepositoryCacheResult[];
  readonly diagnostics: readonly ReferenceDiagnostic[];
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolveLocalPath(cwd: string, value: string): string {
  const expanded = expandHome(value);
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  return path.resolve(cwd, expanded);
}

function stringEntryIsLocal(value: string): boolean {
  return value.startsWith(".") || value.startsWith("/") || value.startsWith("~");
}

function entryDescription(entry: Exclude<ReferenceEntryConfig, string>): string | undefined {
  return entry.description;
}

function entryHidden(entry: Exclude<ReferenceEntryConfig, string>): boolean | undefined {
  return entry.hidden;
}

function resolveEntry(input: {
  readonly cwd: string;
  readonly cacheRoot: string;
  readonly name: string;
  readonly entry: ReferenceEntryConfig;
}): Result<ReferenceInfo, ReferenceDiagnostic> {
  if (typeof input.entry === "string" && stringEntryIsLocal(input.entry)) {
    const source: LocalReferenceSource = {
      type: "local",
      path: resolveLocalPath(input.cwd, input.entry),
    };
    return Result.ok({ name: input.name, path: source.path, source });
  }

  if (typeof input.entry !== "string" && "path" in input.entry) {
    const source: LocalReferenceSource = {
      type: "local",
      path: resolveLocalPath(input.cwd, input.entry.path),
      ...(entryDescription(input.entry) ? { description: entryDescription(input.entry) } : {}),
      ...(entryHidden(input.entry) !== undefined ? { hidden: entryHidden(input.entry) } : {}),
    };
    return Result.ok({
      name: input.name,
      path: source.path,
      ...(source.description ? { description: source.description } : {}),
      ...(source.hidden !== undefined ? { hidden: source.hidden } : {}),
      source,
    });
  }

  const repository = typeof input.entry === "string" ? input.entry : input.entry.repository;
  const branch = typeof input.entry === "string" ? undefined : input.entry.branch;
  const description = typeof input.entry === "string" ? undefined : input.entry.description;
  const hidden = typeof input.entry === "string" ? undefined : input.entry.hidden;
  const parsed = parseRemoteRepositoryReference(repository);
  if (Result.isError(parsed)) {
    return Result.err({ name: input.name, message: parsed.error.message, cause: parsed.error });
  }
  if (branch) {
    const validated = validateBranch(branch);
    if (Result.isError(validated)) {
      return Result.err({
        name: input.name,
        message: validated.error.message,
        cause: validated.error,
      });
    }
  }

  const source: GitReferenceSource = {
    type: "git",
    repository,
    ...(branch ? { branch } : {}),
    ...(description ? { description } : {}),
    ...(hidden !== undefined ? { hidden } : {}),
  };
  return Result.ok({
    name: input.name,
    path: repositoryCachePath(input.cacheRoot, parsed.value),
    ...(description ? { description } : {}),
    ...(hidden !== undefined ? { hidden } : {}),
    source,
  });
}

export function resolveConfiguredReferences(input: {
  readonly cwd: string;
  readonly config: ReferencesRuntimeConfig;
  readonly cacheRoot?: string;
}): ResolvedReferences {
  const cacheRoot = input.cacheRoot ?? defaultReferencesCacheRoot();
  return Object.entries(input.config)
    .map(([name, entry]) => resolveEntry({ cwd: input.cwd, cacheRoot, name, entry }))
    .reduce<ResolvedReferences>(
      (state, result) => {
        if (Result.isOk(result)) {
          return {
            references: [...state.references, result.value],
            diagnostics: state.diagnostics,
          };
        }
        return { references: state.references, diagnostics: [...state.diagnostics, result.error] };
      },
      { references: [], diagnostics: [] },
    );
}

export function renderReferenceGuidance(references: readonly ReferenceInfo[]): string | undefined {
  const available = [...references]
    .filter((reference) => reference.description !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
  if (available.length === 0) return undefined;

  return [
    "Project references provide additional directories that can be accessed when relevant.",
    "<available_references>",
    ...available.flatMap((reference) => [
      "  <reference>",
      `    <name>${reference.name}</name>`,
      `    <path>${reference.path}</path>`,
      `    <description>${reference.description}</description>`,
      "  </reference>",
    ]),
    "</available_references>",
  ].join("\n");
}

export async function materializeGitReferences(input: {
  readonly pi: Pick<ExtensionAPI, "exec">;
  readonly references: readonly ReferenceInfo[];
  readonly cacheRoot?: string;
  readonly signal?: AbortSignal;
}): Promise<MaterializeReferencesResult> {
  const cacheRoot = input.cacheRoot ?? defaultReferencesCacheRoot();
  const materialized = await Promise.all(
    input.references.flatMap((reference) => {
      if (reference.source.type !== "git") return [];
      const source = reference.source;
      return [
        (async () => {
          const parsed = parseRemoteRepositoryReference(source.repository);
          if (Result.isError(parsed)) {
            return Result.err({
              name: reference.name,
              message: parsed.error.message,
              cause: parsed.error,
            });
          }
          const result = await ensureRepository({
            pi: input.pi,
            reference: parsed.value,
            branch: source.branch,
            refresh: true,
            root: cacheRoot,
            ...(input.signal ? { signal: input.signal } : {}),
          });
          if (Result.isError(result)) {
            return Result.err({
              name: reference.name,
              message: result.error.message,
              cause: result.error,
            });
          }
          return Result.ok(result.value);
        })(),
      ];
    }),
  );

  return materialized.reduce<MaterializeReferencesResult>(
    (state, result) => {
      if (Result.isOk(result)) {
        return { results: [...state.results, result.value], diagnostics: state.diagnostics };
      }
      return { results: state.results, diagnostics: [...state.diagnostics, result.error] };
    },
    { results: [], diagnostics: [] },
  );
}
