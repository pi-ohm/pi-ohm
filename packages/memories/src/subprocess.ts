import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Result, TaggedError, type Result as BetterResult } from "better-result";
import { CODEX_STAGE_ONE_SYSTEM_PROMPT } from "./codex-prompts";
import type { MemoryPaths } from "./paths";
import { renderConsolidationPrompt, renderStageOneInputPrompt } from "./prompt";

export class MemorySubprocessError extends TaggedError("MemorySubprocessError")<{
  readonly code: "process_failed" | "output_parse_failed";
  readonly message: string;
  readonly cause?: unknown;
}>() {}

export type MemorySubprocessResult<T> = BetterResult<T, MemorySubprocessError>;

export interface Stage1ModelOutput {
  readonly rollout_summary: string;
  readonly rollout_slug: string | null;
  readonly raw_memory: string;
}

function modelArgs(model: string): string[] {
  const trimmed = model.trim();
  if (trimmed.length === 0) return [];
  return ["--model", trimmed];
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(trimmed)?.[1]?.trim();
  const candidate = fenced ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("No JSON object found");
  return JSON.parse(candidate.slice(start, end + 1));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStage1ModelOutput(value: unknown): value is Stage1ModelOutput {
  if (!isRecord(value)) return false;
  return (
    typeof value.rollout_summary === "string" &&
    (typeof value.rollout_slug === "string" || value.rollout_slug === null) &&
    typeof value.raw_memory === "string"
  );
}

export async function runPiPrint(input: {
  readonly cwd: string;
  readonly model: string;
  readonly prompt: string;
  readonly timeoutMs: number;
  readonly tools?: readonly string[];
  readonly extraArgs?: readonly string[];
  readonly systemPrompt?: string;
}): Promise<MemorySubprocessResult<string>> {
  const workspace = await Result.tryPromise({
    try: async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-memory-"));
      const promptPath = path.join(dir, "prompt.md");
      await fs.writeFile(promptPath, input.prompt, "utf8");
      return { dir, promptPath };
    },
    catch: (cause) =>
      new MemorySubprocessError({
        code: "process_failed",
        message: "Failed to prepare Pi subprocess input",
        cause,
      }),
  });
  if (Result.isError(workspace)) return workspace;

  const args = piPrintArgs(input, workspace.value.promptPath);

  const result = await Result.tryPromise({
    try: async () =>
      await new Promise<string>((resolve, reject) => {
        const child = spawn("pi", args, {
          cwd: input.cwd,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env },
        });
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`pi subprocess timed out after ${input.timeoutMs}ms`));
        }, input.timeoutMs);
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.on("error", reject);
        child.on("close", (code) => {
          clearTimeout(timer);
          const out = Buffer.concat(stdout).toString("utf8");
          const err = Buffer.concat(stderr).toString("utf8");
          if (code === 0) {
            resolve(out.trim());
            return;
          }
          reject(new Error(err.trim() || `pi exited with code ${code ?? "unknown"}`));
        });
      }),
    catch: (cause) =>
      new MemorySubprocessError({
        code: "process_failed",
        message: "Pi subprocess failed",
        cause,
      }),
  });
  const cleaned = await Result.tryPromise({
    try: async () => fs.rm(workspace.value.dir, { recursive: true, force: true }),
    catch: (cause) =>
      new MemorySubprocessError({
        code: "process_failed",
        message: "Failed to clean Pi subprocess workspace",
        cause,
      }),
  });
  if (Result.isError(result)) return result;
  if (Result.isError(cleaned)) return cleaned;
  return result;
}

function piPrintArgs(
  input: {
    readonly model: string;
    readonly tools?: readonly string[];
    readonly extraArgs?: readonly string[];
    readonly systemPrompt?: string;
  },
  promptPath: string,
): string[] {
  return [
    "-p",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    ...(input.systemPrompt ? ["--system-prompt", input.systemPrompt] : []),
    ...(input.tools ? ["--tools", input.tools.join(",")] : ["--no-tools"]),
    ...modelArgs(input.model),
    ...(input.extraArgs ?? []),
    `@${promptPath}`,
  ];
}

export async function runStage1Extractor(input: {
  readonly cwd: string;
  readonly model: string;
  readonly rolloutPath: string;
  readonly rolloutCwd: string;
  readonly rolloutContents: string;
  readonly timeoutMs: number;
}): Promise<MemorySubprocessResult<Stage1ModelOutput | undefined>> {
  const prompt = renderStageOneInputPrompt({
    rolloutPath: input.rolloutPath,
    rolloutCwd: input.rolloutCwd,
    rolloutContents: input.rolloutContents,
  });
  const result = await runPiPrint({
    cwd: input.cwd,
    model: input.model,
    prompt,
    timeoutMs: input.timeoutMs,
    systemPrompt: CODEX_STAGE_ONE_SYSTEM_PROMPT,
  });
  if (Result.isError(result)) return result;

  return Result.try({
    try: () => {
      const parsed = parseJsonObject(result.value);
      if (!isStage1ModelOutput(parsed)) throw new Error("Invalid Stage 1 JSON shape");
      if (parsed.raw_memory.trim().length === 0 && parsed.rollout_summary.trim().length === 0)
        return undefined;
      return parsed;
    },
    catch: (cause) =>
      new MemorySubprocessError({
        code: "output_parse_failed",
        message: "Failed to parse Stage 1 JSON output",
        cause,
      }),
  });
}

export async function runPhase2Consolidator(input: {
  readonly paths: MemoryPaths;
  readonly model: string;
  readonly timeoutMs: number;
}): Promise<MemorySubprocessResult<string>> {
  const prompt = renderConsolidationPrompt(input.paths);

  return runPiPrint({
    cwd: input.paths.data,
    model: input.model,
    prompt,
    timeoutMs: input.timeoutMs,
    tools: ["read", "write", "edit", "grep", "find", "ls"],
    extraArgs: ["--thinking", "medium"],
  });
}
