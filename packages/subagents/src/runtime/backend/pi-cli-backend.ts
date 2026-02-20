import { Result } from "better-result";
import { getSubagentConfiguredModel, type OhmRuntimeConfig } from "@pi-ohm/config";
import type { OhmSubagentDefinition } from "../../catalog";
import { SubagentRuntimeError, type SubagentResult } from "../../errors";
import { buildSendPrompt, buildStartPrompt, truncate } from "./prompts";
import {
  CLI_BACKEND_ROUTE,
  normalizeOutput,
  runPiCliPrompt,
  sanitizeNestedOutput,
  SDK_BACKEND_ROUTE,
} from "./runners";
import { PiSdkTaskExecutionBackend } from "./pi-sdk-backend";
import { ScaffoldTaskExecutionBackend } from "./scaffold-backend";
import type {
  PiCliRunner,
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

export function resolveBackendTimeoutMs(input: {
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

function isSdkFallbackToCliEnabled(): boolean {
  const raw = process.env.OHM_SUBAGENTS_SDK_FALLBACK_TO_CLI;
  if (!raw) return false;

  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
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

function toUnsupportedBackendError(
  taskId: string,
  stage: "execute_start" | "execute_send",
): SubagentRuntimeError {
  return new SubagentRuntimeError({
    code: "unsupported_subagent_backend",
    stage,
    message: "Configured subagent backend is not implemented in @pi-ohm/subagents",
    meta: { taskId, backend: "custom-plugin" },
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

function resolveSubagentModelPattern(input: {
  readonly config: OhmRuntimeConfig;
  readonly subagent: OhmSubagentDefinition;
}): string | undefined {
  return getSubagentConfiguredModel(input.config, input.subagent.id);
}

function parseModelPattern(
  modelPattern: string | undefined,
): { readonly provider: string; readonly model: string } | undefined {
  if (!modelPattern) return undefined;
  const trimmed = modelPattern.trim();
  if (trimmed.length === 0) return undefined;

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) return undefined;

  const provider = trimmed.slice(0, slashIndex).trim().toLowerCase();
  const modelWithThinking = trimmed
    .slice(slashIndex + 1)
    .trim()
    .toLowerCase();
  const model =
    modelWithThinking.endsWith(":off") ||
    modelWithThinking.endsWith(":minimal") ||
    modelWithThinking.endsWith(":low") ||
    modelWithThinking.endsWith(":medium") ||
    modelWithThinking.endsWith(":high") ||
    modelWithThinking.endsWith(":xhigh")
      ? modelWithThinking.slice(0, modelWithThinking.lastIndexOf(":"))
      : modelWithThinking;
  if (provider.length === 0 || model.length === 0) return undefined;

  return { provider, model };
}

export class PiCliTaskExecutionBackend implements TaskExecutionBackend {
  readonly id = SDK_BACKEND_ROUTE;
  private readonly scaffoldBackend = new ScaffoldTaskExecutionBackend();

  constructor(
    private readonly runner: PiCliRunner = runPiCliPrompt,
    private readonly timeoutMs: number = getTimeoutMsFromEnv(),
    private readonly sdkBackend: TaskExecutionBackend = new PiSdkTaskExecutionBackend(),
  ) {}

  resolveBackendId(config: OhmRuntimeConfig): string {
    if (config.subagentBackend === "none") return this.scaffoldBackend.id;
    if (config.subagentBackend === "interactive-shell") return CLI_BACKEND_ROUTE;
    if (config.subagentBackend === "interactive-sdk") return SDK_BACKEND_ROUTE;
    if (config.subagentBackend === "custom-plugin") return "custom-plugin";
    return this.id;
  }

  private shouldFallbackToCli(error: SubagentRuntimeError): boolean {
    if (!isSdkFallbackToCliEnabled()) return false;
    if (error.code !== "task_backend_execution_failed") return false;
    return true;
  }

  private async executeCliStart(
    input: TaskBackendStartInput,
  ): Promise<SubagentResult<TaskBackendStartOutput, SubagentRuntimeError>> {
    const modelPattern = resolveSubagentModelPattern({
      config: input.config,
      subagent: input.subagent,
    });
    const timeoutMs = resolveBackendTimeoutMs({
      fallbackTimeoutMs: this.timeoutMs,
      subagent: input.subagent,
    });
    const parsedModelPattern = parseModelPattern(modelPattern);
    input.onObservability?.({
      provider: parsedModelPattern?.provider ?? "unavailable",
      model: parsedModelPattern?.model ?? "unavailable",
      runtime: "pi-cli",
      route: CLI_BACKEND_ROUTE,
    });
    const run = await this.runner({
      cwd: input.cwd,
      prompt: buildStartPrompt(input),
      modelPattern,
      signal: input.signal,
      timeoutMs,
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

    if (run.exitCode !== 0) {
      return Result.err(
        toBackendExecutionError({
          taskId: input.taskId,
          stage: "execute_start",
          exitCode: run.exitCode,
          stderr: run.stderr,
        }),
      );
    }

    const normalized = sanitizeNestedOutput(normalizeOutput(run.stdout, run.stderr));
    const summary = `${input.subagent.name}: ${truncate(input.description, 72)}`;
    return Result.ok({
      summary,
      output: normalized.output,
      provider: normalized.provider,
      model: normalized.model,
      runtime: normalized.runtime,
      route: CLI_BACKEND_ROUTE,
    });
  }

  private async executeCliSend(
    input: TaskBackendSendInput,
  ): Promise<SubagentResult<TaskBackendSendOutput, SubagentRuntimeError>> {
    const modelPattern = resolveSubagentModelPattern({
      config: input.config,
      subagent: input.subagent,
    });
    const timeoutMs = resolveBackendTimeoutMs({
      fallbackTimeoutMs: this.timeoutMs,
      subagent: input.subagent,
    });
    const parsedModelPattern = parseModelPattern(modelPattern);
    input.onObservability?.({
      provider: parsedModelPattern?.provider ?? "unavailable",
      model: parsedModelPattern?.model ?? "unavailable",
      runtime: "pi-cli",
      route: CLI_BACKEND_ROUTE,
    });
    const run = await this.runner({
      cwd: input.cwd,
      prompt: buildSendPrompt(input),
      modelPattern,
      signal: input.signal,
      timeoutMs,
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

    if (run.exitCode !== 0) {
      return Result.err(
        toBackendExecutionError({
          taskId: input.taskId,
          stage: "execute_send",
          exitCode: run.exitCode,
          stderr: run.stderr,
        }),
      );
    }

    const normalized = sanitizeNestedOutput(normalizeOutput(run.stdout, run.stderr));
    const summary = `${input.subagent.name} follow-up: ${truncate(input.prompt, 72)}`;
    return Result.ok({
      summary,
      output: normalized.output,
      provider: normalized.provider,
      model: normalized.model,
      runtime: normalized.runtime,
      route: CLI_BACKEND_ROUTE,
    });
  }

  async executeStart(
    input: TaskBackendStartInput,
  ): Promise<SubagentResult<TaskBackendStartOutput, SubagentRuntimeError>> {
    if (input.signal?.aborted) {
      return Result.err(toAbortedError(input.taskId, "execute_start"));
    }

    if (input.config.subagentBackend === "none") {
      return this.scaffoldBackend.executeStart(input);
    }

    if (input.config.subagentBackend === "custom-plugin") {
      return Result.err(toUnsupportedBackendError(input.taskId, "execute_start"));
    }

    if (input.config.subagentBackend === "interactive-shell") {
      return this.executeCliStart(input);
    }

    if (input.config.subagentBackend === "interactive-sdk") {
      const sdkResult = await this.sdkBackend.executeStart(input);
      if (Result.isOk(sdkResult)) return sdkResult;
      if (!this.shouldFallbackToCli(sdkResult.error)) return sdkResult;
      return this.executeCliStart(input);
    }

    const sdkResult = await this.sdkBackend.executeStart(input);
    if (Result.isOk(sdkResult)) return sdkResult;
    if (!this.shouldFallbackToCli(sdkResult.error)) return sdkResult;
    return this.executeCliStart(input);
  }

  async executeSend(
    input: TaskBackendSendInput,
  ): Promise<SubagentResult<TaskBackendSendOutput, SubagentRuntimeError>> {
    if (input.signal?.aborted) {
      return Result.err(toAbortedError(input.taskId, "execute_send"));
    }

    if (input.config.subagentBackend === "none") {
      return this.scaffoldBackend.executeSend(input);
    }

    if (input.config.subagentBackend === "custom-plugin") {
      return Result.err(toUnsupportedBackendError(input.taskId, "execute_send"));
    }

    if (input.config.subagentBackend === "interactive-shell") {
      return this.executeCliSend(input);
    }

    if (input.config.subagentBackend === "interactive-sdk") {
      const sdkResult = await this.sdkBackend.executeSend(input);
      if (Result.isOk(sdkResult)) return sdkResult;
      if (!this.shouldFallbackToCli(sdkResult.error)) return sdkResult;
      return this.executeCliSend(input);
    }

    const sdkResult = await this.sdkBackend.executeSend(input);
    if (Result.isOk(sdkResult)) return sdkResult;
    if (!this.shouldFallbackToCli(sdkResult.error)) return sdkResult;
    return this.executeCliSend(input);
  }
}
