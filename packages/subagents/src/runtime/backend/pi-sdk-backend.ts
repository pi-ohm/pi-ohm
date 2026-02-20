import { Result } from "better-result";
import { getSubagentConfiguredModel, type OhmRuntimeConfig } from "@pi-ohm/config";
import type { OhmSubagentDefinition } from "../../catalog";
import { SubagentRuntimeError, type SubagentResult } from "../../errors";
import { buildSendPrompt, buildStartPrompt, truncate } from "./prompts";
import {
  normalizeRunnerOutput,
  runPiSdkPrompt,
  SDK_BACKEND_ROUTE,
  SDK_BACKEND_RUNTIME,
} from "./runners";
import type {
  PiSdkRunner,
  TaskBackendSendInput,
  TaskBackendSendOutput,
  TaskBackendStartInput,
  TaskBackendStartOutput,
  TaskExecutionBackend,
} from "./types";

const DEFAULT_BACKEND_TIMEOUT_MS = 180_000;
const DEFAULT_LIBRARIAN_TIMEOUT_MS = 300_000;
const DEFAULT_ORACLE_TIMEOUT_MS = 3_600_000;

function parsePositiveInteger(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function getTimeoutMsFromEnv(): number {
  return (
    parsePositiveInteger(process.env.OHM_SUBAGENTS_BACKEND_TIMEOUT_MS) ?? DEFAULT_BACKEND_TIMEOUT_MS
  );
}

function getSubagentTimeoutMsFromEnv(subagentId: string): number | undefined {
  const key = `OHM_SUBAGENTS_BACKEND_TIMEOUT_MS_${subagentId.trim().toUpperCase()}`;
  return parsePositiveInteger(process.env[key]);
}

function resolveBackendTimeoutMs(input: {
  readonly fallbackTimeoutMs: number;
  readonly subagent: OhmSubagentDefinition;
}): number {
  const fromSubagentEnv = getSubagentTimeoutMsFromEnv(input.subagent.id);
  if (fromSubagentEnv !== undefined) return fromSubagentEnv;

  const fromGlobalEnv = getTimeoutMsFromEnv();
  const base = fromGlobalEnv > 0 ? fromGlobalEnv : input.fallbackTimeoutMs;

  if (input.subagent.id === "librarian") {
    return Math.max(base, DEFAULT_LIBRARIAN_TIMEOUT_MS);
  }

  if (input.subagent.id === "oracle") {
    return Math.max(base, DEFAULT_ORACLE_TIMEOUT_MS);
  }

  return base;
}

function resolveSubagentModelPattern(input: {
  readonly config: OhmRuntimeConfig;
  readonly subagent: OhmSubagentDefinition;
}): string | undefined {
  return getSubagentConfiguredModel(input.config, input.subagent.id);
}

function toAbortedError(
  taskId: string,
  stage: "execute_start" | "execute_send",
): SubagentRuntimeError {
  return new SubagentRuntimeError({
    code: "task_aborted",
    stage,
    message: `Task ${taskId} was aborted before execution`,
    meta: { taskId },
  });
}

function toBackendTimeoutError(input: {
  readonly taskId: string;
  readonly stage: "execute_start" | "execute_send";
  readonly timeoutMs: number;
  readonly subagentId: string;
  readonly modelPattern: string | undefined;
}): SubagentRuntimeError {
  const timeoutSeconds = Math.max(1, Math.round(input.timeoutMs / 1000));
  const modelHint = input.modelPattern ? ` (model: ${input.modelPattern})` : "";
  const guidance =
    input.subagentId === "oracle"
      ? "Narrow oracle task scope/context/files or raise OHM_SUBAGENTS_BACKEND_TIMEOUT_MS_ORACLE."
      : `Narrow task scope or raise OHM_SUBAGENTS_BACKEND_TIMEOUT_MS_${input.subagentId.toUpperCase()} (or OHM_SUBAGENTS_BACKEND_TIMEOUT_MS).`;

  return new SubagentRuntimeError({
    code: "task_backend_timeout",
    stage: input.stage,
    message: `Task ${input.taskId} timed out after ${timeoutSeconds}s while waiting for '${input.subagentId}' backend response${modelHint}. ${guidance}`,
    meta: {
      taskId: input.taskId,
      timeoutMs: input.timeoutMs,
      timeoutSeconds,
      subagentId: input.subagentId,
      modelPattern: input.modelPattern,
    },
  });
}

function toBackendExecutionError(input: {
  readonly taskId: string;
  readonly stage: "execute_start" | "execute_send";
  readonly exitCode: number;
  readonly stderr: string;
}): SubagentRuntimeError {
  const errorText = input.stderr.trim();
  const summary =
    errorText.length > 0 ? truncate(errorText, 260) : "subagent backend exited non-zero";

  return new SubagentRuntimeError({
    code: "task_backend_execution_failed",
    stage: input.stage,
    message: `Task ${input.taskId} backend failed: ${summary}`,
    meta: {
      taskId: input.taskId,
      exitCode: input.exitCode,
      stderr: errorText,
    },
  });
}

export class PiSdkTaskExecutionBackend implements TaskExecutionBackend {
  readonly id = "interactive-sdk";

  constructor(
    private readonly runner: PiSdkRunner = runPiSdkPrompt,
    private readonly timeoutMs: number = getTimeoutMsFromEnv(),
  ) {}

  resolveBackendId(config: OhmRuntimeConfig): string {
    if (config.subagentBackend === "none") return "scaffold";
    if (config.subagentBackend === "custom-plugin") return "custom-plugin";
    return this.id;
  }

  async executeStart(
    input: TaskBackendStartInput,
  ): Promise<SubagentResult<TaskBackendStartOutput, SubagentRuntimeError>> {
    if (input.signal?.aborted) {
      return Result.err(toAbortedError(input.taskId, "execute_start"));
    }

    const modelPattern = resolveSubagentModelPattern({
      config: input.config,
      subagent: input.subagent,
    });
    const timeoutMs = resolveBackendTimeoutMs({
      fallbackTimeoutMs: this.timeoutMs,
      subagent: input.subagent,
    });

    const run = await this.runner({
      cwd: input.cwd,
      prompt: buildStartPrompt(input),
      modelPattern,
      signal: input.signal,
      timeoutMs,
      onEvent: input.onEvent,
    });

    if (run.aborted || input.signal?.aborted) {
      return Result.err(toAbortedError(input.taskId, "execute_start"));
    }

    if (run.timedOut) {
      return Result.err(
        toBackendTimeoutError({
          taskId: input.taskId,
          stage: "execute_start",
          timeoutMs,
          subagentId: input.subagent.id,
          modelPattern,
        }),
      );
    }

    if (run.error) {
      return Result.err(
        toBackendExecutionError({
          taskId: input.taskId,
          stage: "execute_start",
          exitCode: 1,
          stderr: run.error,
        }),
      );
    }

    const summary = `${input.subagent.name}: ${truncate(input.description, 72)}`;
    return Result.ok({
      summary,
      output: normalizeRunnerOutput(run.output),
      provider: run.provider ?? "unavailable",
      model: run.model ?? "unavailable",
      runtime: run.runtime ?? SDK_BACKEND_RUNTIME,
      route: SDK_BACKEND_ROUTE,
      events: run.events,
    });
  }

  async executeSend(
    input: TaskBackendSendInput,
  ): Promise<SubagentResult<TaskBackendSendOutput, SubagentRuntimeError>> {
    if (input.signal?.aborted) {
      return Result.err(toAbortedError(input.taskId, "execute_send"));
    }

    const modelPattern = resolveSubagentModelPattern({
      config: input.config,
      subagent: input.subagent,
    });
    const timeoutMs = resolveBackendTimeoutMs({
      fallbackTimeoutMs: this.timeoutMs,
      subagent: input.subagent,
    });

    const run = await this.runner({
      cwd: input.cwd,
      prompt: buildSendPrompt(input),
      modelPattern,
      signal: input.signal,
      timeoutMs,
      onEvent: input.onEvent,
    });

    if (run.aborted || input.signal?.aborted) {
      return Result.err(toAbortedError(input.taskId, "execute_send"));
    }

    if (run.timedOut) {
      return Result.err(
        toBackendTimeoutError({
          taskId: input.taskId,
          stage: "execute_send",
          timeoutMs,
          subagentId: input.subagent.id,
          modelPattern,
        }),
      );
    }

    if (run.error) {
      return Result.err(
        toBackendExecutionError({
          taskId: input.taskId,
          stage: "execute_send",
          exitCode: 1,
          stderr: run.error,
        }),
      );
    }

    const summary = `${input.subagent.name} follow-up: ${truncate(input.prompt, 72)}`;
    return Result.ok({
      summary,
      output: normalizeRunnerOutput(run.output),
      provider: run.provider ?? "unavailable",
      model: run.model ?? "unavailable",
      runtime: run.runtime ?? SDK_BACKEND_RUNTIME,
      route: SDK_BACKEND_ROUTE,
      events: run.events,
    });
  }
}
