import fs from "node:fs/promises";
import path from "node:path";
import { Result, TaggedError, type Result as BetterResult } from "better-result";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { CODEX_AD_HOC_INSTRUCTIONS } from "./codex-prompts";
import type { Stage1Output } from "./db";
import type { MemoryPaths } from "./paths";

export class MemoryLayoutError extends TaggedError("MemoryLayoutError")<{
  readonly code: "layout_failed" | "summary_read_failed";
  readonly message: string;
  readonly cause?: unknown;
}>() {}

const NodeErrorLikeSchema = Type.Object(
  { code: Type.Optional(Type.Unknown()) },
  { additionalProperties: true },
);

export type MemoryLayoutResult<T> = BetterResult<T, MemoryLayoutError>;

export async function ensureMemoryLayout(paths: MemoryPaths): Promise<MemoryLayoutResult<true>> {
  return Result.tryPromise({
    try: async () => {
      await fs.mkdir(paths.data, { recursive: true });
      await fs.mkdir(paths.rollouts, { recursive: true });
      await fs.mkdir(paths.skills, { recursive: true });
      await fs.mkdir(paths.extensions, { recursive: true });
      await fs.mkdir(paths.adhoc, { recursive: true });
      await fs.mkdir(paths.notes, { recursive: true });
      await fs.writeFile(
        path.join(paths.adhoc, "instructions.md"),
        CODEX_AD_HOC_INSTRUCTIONS,
        "utf8",
      );
      return true as const;
    },
    catch: (cause) =>
      new MemoryLayoutError({
        code: "layout_failed",
        message: "Failed to create memory layout",
        cause,
      }),
  });
}

export async function readSummary(
  paths: MemoryPaths,
  maxChars: number,
): Promise<MemoryLayoutResult<string | undefined>> {
  const result = await Result.tryPromise({
    try: async () => fs.readFile(paths.summary, "utf8"),
    catch: (cause) =>
      new MemoryLayoutError({
        code: "summary_read_failed",
        message: "Failed to read memory summary",
        cause,
      }),
  });
  if (Result.isError(result)) {
    if (errorCode(result.error.cause) === "ENOENT") return Result.ok(undefined);
    return result;
  }
  const raw = result.value.trim();
  if (raw.length === 0) return Result.ok(undefined);
  return Result.ok(raw.slice(0, maxChars));
}

function errorCode(value: unknown): string | undefined {
  if (!Value.Check(NodeErrorLikeSchema, value)) return undefined;
  return typeof value.code === "string" ? value.code : undefined;
}

function stamp(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date(0).toISOString();
  return date.toISOString();
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+/u, "")
    .replace(/_+$/u, "")
    .slice(0, 60);
  if (normalized.length > 0) return normalized;
  return "memory";
}

function summaryFile(output: Stage1Output): string {
  return `${stamp(output.sourceUpdatedAt).replace(/[:.]/gu, "-")}-${output.threadId.slice(0, 8)}-${slug(output.rolloutSlug ?? output.threadId)}.md`;
}

export async function consolidateMemoryFiles(
  paths: MemoryPaths,
  outputs: readonly Stage1Output[],
): Promise<MemoryLayoutResult<true>> {
  return Result.tryPromise({
    try: async () => {
      await ensureMemoryLayout(paths);
      const files = outputs.map((output) => ({ output, file: summaryFile(output) }));
      const raw =
        outputs.length === 0
          ? "# Raw Memories\n\nNo raw memories yet.\n"
          : [
              "# Raw Memories",
              "",
              "Merged stage-1 raw memories (stable ascending thread-id order):",
              "",
              ...files.flatMap((item) => [
                `## Thread \`${item.output.threadId}\``,
                `updated_at: ${stamp(item.output.sourceUpdatedAt)}`,
                `cwd: ${item.output.cwd ?? ""}`,
                `rollout_path: ${item.output.rolloutPath ?? ""}`,
                `rollout_summary_file: ${item.file}`,
                "",
                item.output.rawMemory,
                "",
              ]),
            ].join("\n");

      await fs.writeFile(paths.raw, raw, "utf8");

      const existing = await fs.readdir(paths.rollouts).then(
        (entries) => entries.filter((entry) => entry.endsWith(".md")),
        () => [],
      );
      const expected = files.map((item) => item.file);
      await Promise.all(
        existing
          .filter((entry) => !expected.includes(entry))
          .map((entry) => fs.rm(path.join(paths.rollouts, entry), { force: true })),
      );

      await Promise.all(
        files.map((item) =>
          fs.writeFile(
            path.join(paths.rollouts, item.file),
            [
              `thread_id: ${item.output.threadId}`,
              `updated_at: ${stamp(item.output.sourceUpdatedAt)}`,
              `rollout_path: ${item.output.rolloutPath ?? ""}`,
              `cwd: ${item.output.cwd ?? ""}`,
              "",
              item.output.rolloutSummary,
              "",
            ].join("\n"),
            "utf8",
          ),
        ),
      );

      return true as const;
    },
    catch: (cause) =>
      new MemoryLayoutError({
        code: "layout_failed",
        message: "Failed to consolidate memory files",
        cause,
      }),
  });
}

export async function resetMemoryFiles(paths: MemoryPaths): Promise<MemoryLayoutResult<true>> {
  return Result.tryPromise({
    try: async () => {
      await fs.rm(paths.summary, { force: true });
      await fs.rm(paths.registry, { force: true });
      await fs.rm(paths.raw, { force: true });
      await fs.rm(paths.diff, { force: true });
      await fs.rm(paths.rollouts, { recursive: true, force: true });
      await fs.rm(paths.extensions, { recursive: true, force: true });
      await ensureMemoryLayout(paths);
      return true as const;
    },
    catch: (cause) =>
      new MemoryLayoutError({
        code: "layout_failed",
        message: "Failed to reset memory files",
        cause,
      }),
  });
}

export async function writeAdhocNote(
  paths: MemoryPaths,
  text: string,
  now: number,
): Promise<MemoryLayoutResult<string>> {
  return Result.tryPromise({
    try: async () => {
      await ensureMemoryLayout(paths);
      const file = `${new Date(now).toISOString().replace(/[:.]/gu, "-")}-note.md`;
      const target = path.join(paths.notes, file);
      await fs.writeFile(target, `${text.trim()}\n`, "utf8");
      return target;
    },
    catch: (cause) =>
      new MemoryLayoutError({
        code: "layout_failed",
        message: "Failed to write memory note",
        cause,
      }),
  });
}

async function git(
  paths: MemoryPaths,
  args: readonly string[],
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const child = await import("node:child_process");
  return new Promise((resolve) => {
    child.execFile("git", [...args], { cwd: paths.data }, (error, stdout, stderr) => {
      const code = typeof error?.code === "number" ? error.code : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

export async function ensureGitBaseline(paths: MemoryPaths): Promise<MemoryLayoutResult<true>> {
  return Result.tryPromise({
    try: async () => {
      await ensureMemoryLayout(paths);
      const gitDir = path.join(paths.data, ".git");
      const exists = await fs.access(gitDir).then(
        () => true,
        () => false,
      );
      if (!exists) {
        await git(paths, ["init"]);
        await git(paths, ["config", "user.email", "pi-ohm-memories@example.invalid"]);
        await git(paths, ["config", "user.name", "Pi OHM Memories"]);
        await git(paths, ["add", "-A"]);
        await git(paths, ["commit", "--allow-empty", "-m", "baseline"]);
      }
      return true as const;
    },
    catch: (cause) =>
      new MemoryLayoutError({
        code: "layout_failed",
        message: "Failed to initialize memory git baseline",
        cause,
      }),
  });
}

export async function writeWorkspaceDiff(paths: MemoryPaths): Promise<MemoryLayoutResult<boolean>> {
  return Result.tryPromise({
    try: async () => {
      await git(paths, ["add", "-N", "."]);
      const diff = await git(paths, ["diff", "--", "."]);
      const changed = diff.stdout.trim().length > 0;
      if (changed) await fs.writeFile(paths.diff, diff.stdout, "utf8");
      return changed;
    },
    catch: (cause) =>
      new MemoryLayoutError({
        code: "layout_failed",
        message: "Failed to write memory workspace diff",
        cause,
      }),
  });
}

export async function resetGitBaseline(paths: MemoryPaths): Promise<MemoryLayoutResult<true>> {
  return Result.tryPromise({
    try: async () => {
      await fs.rm(paths.diff, { force: true });
      await git(paths, ["add", "-A"]);
      await git(paths, ["commit", "--allow-empty", "-m", "baseline"]);
      return true as const;
    },
    catch: (cause) =>
      new MemoryLayoutError({
        code: "layout_failed",
        message: "Failed to reset memory git baseline",
        cause,
      }),
  });
}
