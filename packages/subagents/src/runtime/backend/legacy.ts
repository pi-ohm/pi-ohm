import { spawn } from "node:child_process";
import {
  createAgentSession,
  createBashTool,
  createEditTool,
  createExtensionRuntime,
  createReadTool,
  createWriteTool,
  SessionManager,
  SettingsManager,
  type ResourceLoader,
} from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { Result } from "better-result";
import { getSubagentConfiguredModel, type OhmRuntimeConfig } from "@pi-ohm/config";
import type { OhmSubagentDefinition } from "../../catalog";
import { SubagentRuntimeError, type SubagentResult } from "../../errors";
import { parseTaskExecutionEventFromSdk, type TaskExecutionEvent } from "../events";

export interface TaskBackendStartInput {
  readonly taskId: string;
  readonly subagent: OhmSubagentDefinition;
  readonly description: string;
  readonly prompt: string;
  readonly config: OhmRuntimeConfig;
  readonly cwd: string;
  readonly signal: AbortSignal | undefined;
  readonly onEvent?: (event: TaskExecutionEvent) => void;
}

export interface TaskBackendStartOutput {
  readonly summary: string;
  readonly output: string;
  readonly provider?: string;
  readonly model?: string;
  readonly runtime?: string;
  readonly route?: string;
  readonly events?: readonly TaskExecutionEvent[];
}

export interface TaskBackendSendInput {
  readonly taskId: string;
  readonly subagent: OhmSubagentDefinition;
  readonly description: string;
  readonly initialPrompt: string;
  readonly followUpPrompts: readonly string[];
  readonly prompt: string;
  readonly config: OhmRuntimeConfig;
  readonly cwd: string;
  readonly signal: AbortSignal | undefined;
  readonly onEvent?: (event: TaskExecutionEvent) => void;
}

export interface TaskBackendSendOutput {
  readonly summary: string;
  readonly output: string;
  readonly provider?: string;
  readonly model?: string;
  readonly runtime?: string;
  readonly route?: string;
  readonly events?: readonly TaskExecutionEvent[];
}

export interface TaskExecutionBackend {
  readonly id: string;
  resolveBackendId?(config: OhmRuntimeConfig): string;
  executeStart(
    input: TaskBackendStartInput,
  ): Promise<SubagentResult<TaskBackendStartOutput, SubagentRuntimeError>>;
  executeSend(
    input: TaskBackendSendInput,
  ): Promise<SubagentResult<TaskBackendSendOutput, SubagentRuntimeError>>;
}

function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return input.slice(0, maxLength - 1) + "…";
}

function normalizeOutput(stdout: string, stderr: string): string {
  const trimmedStdout = stdout.trim();
  if (trimmedStdout.length > 0) return trimmedStdout;

  const trimmedStderr = stderr.trim();
  if (trimmedStderr.length > 0) return trimmedStderr;

  return "(no output)";
}

interface NestedOutputNormalization {
  readonly output: string;
  readonly provider: string;
  readonly model: string;
  readonly runtime: string;
}

function sanitizeNestedOutput(output: string): NestedOutputNormalization {
  const lines = output.split(/\r?\n/u);
  const retained: string[] = [];

  let provider = "unavailable";
  let model = "unavailable";
  let runtime = "pi-cli";

  for (const line of lines) {
    const matched = line.match(/^\s*(backend|provider|model|runtime|route)\s*:\s*(.+)\s*$/iu);
    if (!matched) {
      retained.push(line);
      continue;
    }

    const key = matched[1]?.toLowerCase();
    const value = matched[2]?.trim() ?? "";
    if (value.length === 0) continue;

    if (key === "provider") {
      provider = value;
      continue;
    }

    if (key === "model") {
      model = value;
      continue;
    }

    if (key === "runtime" || key === "backend") {
      runtime = value;
      continue;
    }
  }

  const sanitized = retained.join("\n").trim();
  return {
    output: sanitized.length > 0 ? sanitized : "(no output)",
    provider,
    model,
    runtime,
  };
}

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

  if (input.subagent.id === "librarian") {
    return Math.max(input.fallbackTimeoutMs, DEFAULT_LIBRARIAN_TIMEOUT_MS);
  }

  if (input.subagent.id === "oracle") {
    return Math.max(input.fallbackTimeoutMs, DEFAULT_ORACLE_TIMEOUT_MS);
  }

  return input.fallbackTimeoutMs;
}

function isSdkFallbackToCliEnabled(): boolean {
  const raw = process.env.OHM_SUBAGENTS_SDK_FALLBACK_TO_CLI;
  if (!raw) return false;

  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export interface PiCliRunnerInput {
  readonly cwd: string;
  readonly prompt: string;
  readonly modelPattern?: string;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
}

export interface PiCliRunnerResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly aborted: boolean;
}

export type PiCliRunner = (input: PiCliRunnerInput) => Promise<PiCliRunnerResult>;

export interface PiSdkRunnerInput {
  readonly cwd: string;
  readonly prompt: string;
  readonly modelPattern?: string;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
  readonly onEvent?: (event: TaskExecutionEvent) => void;
}

export interface PiSdkRunnerResult {
  readonly output: string;
  readonly provider?: string;
  readonly model?: string;
  readonly runtime?: string;
  readonly events: readonly TaskExecutionEvent[];
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly error?: string;
}

export type PiSdkRunner = (input: PiSdkRunnerInput) => Promise<PiSdkRunnerResult>;

const PI_CLI_TOOLS = "read,bash,edit,write,grep,find,ls";
const SDK_BACKEND_RUNTIME = "pi-sdk";
const SDK_BACKEND_ROUTE = "interactive-sdk";
const CLI_BACKEND_ROUTE = "interactive-shell";

export interface PiSdkStreamCaptureState {
  assistantChunks: string[];
  toolLines: string[];
  events: TaskExecutionEvent[];
  sawAgentEnd: boolean;
  capturedEventCount: number;
}

export interface PiSdkStreamCaptureResult {
  readonly output: string;
  readonly events: readonly TaskExecutionEvent[];
  readonly sawAgentEnd: boolean;
  readonly capturedEventCount: number;
}

function formatToolLifecycleLine(input: {
  readonly toolName: string;
  readonly phase: "start" | "update" | "end success" | "end error";
  readonly payload: string | undefined;
}): string {
  const base = `tool_call: ${input.toolName} ${input.phase}`;
  if (!input.payload) return base;
  return `${base} ${input.payload}`;
}

export function createPiSdkStreamCaptureState(): PiSdkStreamCaptureState {
  return {
    assistantChunks: [],
    toolLines: [],
    events: [],
    sawAgentEnd: false,
    capturedEventCount: 0,
  };
}

export function applyPiSdkSessionEvent(
  state: PiSdkStreamCaptureState,
  event: unknown,
): TaskExecutionEvent | undefined {
  const parsed = parseTaskExecutionEventFromSdk(event);
  if (Result.isError(parsed)) return undefined;
  if (!parsed.value) return undefined;

  state.capturedEventCount += 1;
  state.events.push(parsed.value);

  if (parsed.value.type === "assistant_text_delta") {
    state.assistantChunks.push(parsed.value.delta);
    return parsed.value;
  }

  if (parsed.value.type === "tool_start") {
    state.toolLines.push(
      formatToolLifecycleLine({
        toolName: parsed.value.toolName,
        phase: "start",
        payload: parsed.value.argsText,
      }),
    );
    return parsed.value;
  }

  if (parsed.value.type === "tool_update") {
    state.toolLines.push(
      formatToolLifecycleLine({
        toolName: parsed.value.toolName,
        phase: "update",
        payload: parsed.value.partialText,
      }),
    );
    return parsed.value;
  }

  if (parsed.value.type === "tool_end") {
    state.toolLines.push(
      formatToolLifecycleLine({
        toolName: parsed.value.toolName,
        phase: parsed.value.status === "error" ? "end error" : "end success",
        payload: parsed.value.resultText,
      }),
    );
    return parsed.value;
  }

  if (parsed.value.type === "task_terminal") {
    state.sawAgentEnd = true;
    return parsed.value;
  }

  return parsed.value;
}

export function finalizePiSdkStreamCapture(
  state: PiSdkStreamCaptureState,
): PiSdkStreamCaptureResult {
  const assistantText = normalizeRunnerOutput(state.assistantChunks.join(""));
  const parts: string[] = [...state.toolLines];

  if (assistantText !== "(no output)") {
    parts.push(assistantText);
  }

  return {
    output: parts.length > 0 ? parts.join("\n").trim() : "(no output)",
    events: [...state.events],
    sawAgentEnd: state.sawAgentEnd,
    capturedEventCount: state.capturedEventCount,
  };
}

function createSdkResourceLoader(): ResourceLoader {
  const runtime = createExtensionRuntime();

  return {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime,
    }),
    getSkills: () => ({
      skills: [],
      diagnostics: [],
    }),
    getPrompts: () => ({
      prompts: [],
      diagnostics: [],
    }),
    getThemes: () => ({
      themes: [],
      diagnostics: [],
    }),
    getAgentsFiles: () => ({
      agentsFiles: [],
    }),
    getSystemPrompt: () =>
      [
        "You are the Pi OHM subagent runtime.",
        "Use available tools only when required.",
        "Return concise concrete findings.",
      ].join(" "),
    getAppendSystemPrompt: () => [],
    getPathMetadata: () => new Map(),
    extendResources: () => {},
    reload: async () => {},
  };
}

function normalizeRunnerOutput(output: string): string {
  const trimmed = output.trim();
  return trimmed.length > 0 ? trimmed : "(no output)";
}

function parseProviderModelPattern(
  modelPattern: string,
): { readonly provider: string; readonly modelId: string } | undefined {
  const trimmed = modelPattern.trim();
  if (trimmed.length === 0) return undefined;

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) return undefined;

  const provider = trimmed.slice(0, slashIndex).trim().toLowerCase();
  const modelId = trimmed.slice(slashIndex + 1).trim();
  if (provider.length === 0 || modelId.length === 0) return undefined;

  return { provider, modelId };
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

export interface ParsedSubagentModelSelection {
  readonly provider: string;
  readonly modelId: string;
  readonly thinkingLevel?: ThinkingLevel;
}

export type ParseSubagentModelSelectionResult =
  | {
      readonly ok: true;
      readonly value: ParsedSubagentModelSelection;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid_format" | "invalid_thinking_level" | "model_not_found";
      readonly message: string;
    };

export function parseSubagentModelSelection(input: {
  readonly modelPattern: string;
  readonly hasModel: (provider: string, modelId: string) => boolean;
}): ParseSubagentModelSelectionResult {
  const parsedBase = parseProviderModelPattern(input.modelPattern);
  if (!parsedBase) {
    return {
      ok: false,
      reason: "invalid_format",
      message: `Invalid subagent model '${input.modelPattern}'. Expected '<provider>/<model>' or '<provider>/<model>:<thinking>'.`,
    };
  }

  const fullModelId = parsedBase.modelId;
  if (input.hasModel(parsedBase.provider, fullModelId)) {
    return {
      ok: true,
      value: {
        provider: parsedBase.provider,
        modelId: fullModelId,
      },
    };
  }

  const colonIndex = fullModelId.lastIndexOf(":");
  if (colonIndex <= 0 || colonIndex >= fullModelId.length - 1) {
    return {
      ok: false,
      reason: "model_not_found",
      message: `Configured subagent model '${input.modelPattern}' was not found.`,
    };
  }

  const thinkingRaw = fullModelId
    .slice(colonIndex + 1)
    .trim()
    .toLowerCase();
  if (!isThinkingLevel(thinkingRaw)) {
    return {
      ok: false,
      reason: "invalid_thinking_level",
      message: `Invalid subagent thinking level '${thinkingRaw}' in '${input.modelPattern}'.`,
    };
  }

  const modelId = fullModelId.slice(0, colonIndex).trim();
  if (modelId.length === 0) {
    return {
      ok: false,
      reason: "invalid_format",
      message: `Invalid subagent model '${input.modelPattern}'. Expected '<provider>/<model>' or '<provider>/<model>:<thinking>'.`,
    };
  }

  if (!input.hasModel(parsedBase.provider, modelId)) {
    return {
      ok: false,
      reason: "model_not_found",
      message: `Configured subagent model '${input.modelPattern}' was not found.`,
    };
  }

  return {
    ok: true,
    value: {
      provider: parsedBase.provider,
      modelId,
      thinkingLevel: thinkingRaw,
    },
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const trimmed = error.message.trim();
    return trimmed.length > 0 ? trimmed : "unknown backend error";
  }

  if (typeof error === "string") {
    const trimmed = error.trim();
    return trimmed.length > 0 ? trimmed : "unknown backend error";
  }

  return "unknown backend error";
}

async function abortSdkSession(session: { readonly abort: () => Promise<void> }): Promise<void> {
  try {
    await session.abort();
  } catch {
    // noop: abort used as best-effort cancellation signal.
  }
}

export const runPiSdkPrompt: PiSdkRunner = async (
  input: PiSdkRunnerInput,
): Promise<PiSdkRunnerResult> => {
  if (input.signal?.aborted) {
    return {
      output: "",
      events: [],
      timedOut: false,
      aborted: true,
    };
  }

  const captureState = createPiSdkStreamCaptureState();
  let timedOut = false;
  let aborted = false;
  let errorText: string | undefined;
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let resolvedModelProvider = "unavailable";
  let resolvedModelId = "unavailable";

  try {
    const created = await createAgentSession({
      cwd: input.cwd,
      resourceLoader: createSdkResourceLoader(),
      tools: [
        createReadTool(input.cwd),
        createBashTool(input.cwd),
        createEditTool(input.cwd),
        createWriteTool(input.cwd),
      ],
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
      }),
    });

    session = created.session;
    const activeSession = session;

    if (input.modelPattern) {
      const selection = parseSubagentModelSelection({
        modelPattern: input.modelPattern,
        hasModel: (provider, modelId) =>
          activeSession.modelRegistry.find(provider, modelId) !== undefined,
      });
      if (!selection.ok) {
        const providerCandidatePattern = parseProviderModelPattern(input.modelPattern);
        const providerCandidates = providerCandidatePattern
          ? activeSession.modelRegistry
              .getAll()
              .filter((candidate) => candidate.provider === providerCandidatePattern.provider)
              .map((candidate) => candidate.id)
              .slice(0, 8)
          : [];
        const providerHint =
          selection.reason === "model_not_found" && providerCandidates.length > 0
            ? ` Available for '${providerCandidatePattern?.provider ?? ""}': ${providerCandidates.join(", ")}.`
            : "";

        activeSession.dispose();
        return {
          output: "",
          events: [],
          timedOut: false,
          aborted: false,
          error: `${selection.message}${providerHint}`,
        };
      }

      const model = activeSession.modelRegistry.find(
        selection.value.provider,
        selection.value.modelId,
      );
      if (!model) {
        activeSession.dispose();
        return {
          output: "",
          events: [],
          timedOut: false,
          aborted: false,
          error: `Configured subagent model '${input.modelPattern}' was not found.`,
        };
      }

      await activeSession.setModel(model);
      if (selection.value.thinkingLevel) {
        activeSession.setThinkingLevel(selection.value.thinkingLevel);
      }
      resolvedModelProvider = model.provider;
      resolvedModelId = model.id;
    }
  } catch (error) {
    return {
      output: "",
      events: [],
      timedOut: false,
      aborted: false,
      error: toErrorMessage(error),
    };
  }

  if (!session) {
    return {
      output: "",
      events: [],
      timedOut: false,
      aborted: false,
      error: "Failed to create subagent sdk session",
    };
  }

  const unsubscribe = session.subscribe((event) => {
    const captured = applyPiSdkSessionEvent(captureState, event);
    if (!captured) return;
    input.onEvent?.(captured);
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => {
    aborted = true;
    void abortSdkSession(session);
  };

  if (input.signal) {
    input.signal.addEventListener("abort", onAbort, { once: true });
  }

  timeoutHandle = setTimeout(() => {
    timedOut = true;
    void abortSdkSession(session);
  }, input.timeoutMs);

  try {
    await session.prompt(input.prompt);
  } catch (error) {
    errorText = toErrorMessage(error);
  } finally {
    clearTimeout(timeoutHandle);
    if (input.signal) {
      input.signal.removeEventListener("abort", onAbort);
    }
    unsubscribe();
    session.dispose();
  }

  if (aborted || input.signal?.aborted) {
    return {
      output: "",
      events: [...captureState.events],
      timedOut: false,
      aborted: true,
    };
  }

  if (timedOut) {
    return {
      output: "",
      events: [...captureState.events],
      timedOut: true,
      aborted: false,
    };
  }

  if (errorText) {
    return {
      output: "",
      events: [...captureState.events],
      timedOut: false,
      aborted: false,
      error: errorText,
    };
  }

  const finalized = finalizePiSdkStreamCapture(captureState);

  return {
    output: finalized.output,
    events: finalized.events,
    provider: resolvedModelProvider,
    model: resolvedModelId,
    runtime: SDK_BACKEND_RUNTIME,
    timedOut: false,
    aborted: false,
  };
};

export const runPiCliPrompt: PiCliRunner = async (
  input: PiCliRunnerInput,
): Promise<PiCliRunnerResult> => {
  if (input.signal?.aborted) {
    return {
      exitCode: 130,
      stdout: "",
      stderr: "",
      timedOut: false,
      aborted: true,
    };
  }

  return new Promise<PiCliRunnerResult>((resolve) => {
    const args = ["--print", "--no-session", "--no-extensions", "--tools", PI_CLI_TOOLS];
    if (input.modelPattern) {
      args.push("--model", input.modelPattern);
    }
    args.push(input.prompt);

    const proc = spawn("pi", args, {
      cwd: input.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 1000);
    }, input.timeoutMs);

    const finish = (result: PiCliRunnerResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (input.signal) {
        input.signal.removeEventListener("abort", onAbort);
      }
      resolve(result);
    };

    const onAbort = (): void => {
      aborted = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 1000);
    };

    if (input.signal) {
      input.signal.addEventListener("abort", onAbort, { once: true });
    }

    proc.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      const nextStderr = `${stderr}\n${error.message}`.trim();
      finish({
        exitCode: 1,
        stdout,
        stderr: nextStderr,
        timedOut,
        aborted,
      });
    });

    proc.on("close", (code) => {
      finish({
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr,
        timedOut,
        aborted,
      });
    });
  });
};

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
}) {
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

function buildStartPrompt(input: TaskBackendStartInput): string {
  return [
    `You are the ${input.subagent.name} subagent in Pi OHM.`,
    "",
    `Subagent summary: ${input.subagent.summary}`,
    "When to use:",
    ...input.subagent.whenToUse.map((line) => `- ${line}`),
    "",
    "Profile scaffold guidance:",
    input.subagent.scaffoldPrompt,
    "",
    `Task description: ${input.description}`,
    "",
    "User task:",
    input.prompt,
    "",
    "Return concrete findings/results. Avoid repeating this prompt verbatim.",
  ].join("\n");
}

function buildSendPrompt(input: TaskBackendSendInput): string {
  const priorPrompts = [input.initialPrompt, ...input.followUpPrompts]
    .map((prompt, index) => `${index + 1}. ${prompt}`)
    .join("\n");

  return [
    `You are continuing the ${input.subagent.name} subagent task.`,
    `Task description: ${input.description}`,
    "",
    "Task history:",
    priorPrompts,
    "",
    "Latest follow-up request:",
    input.prompt,
    "",
    "Return only the updated findings/result.",
  ].join("\n");
}

function resolveSubagentModelPattern(input: {
  readonly config: OhmRuntimeConfig;
  readonly subagent: OhmSubagentDefinition;
}): string | undefined {
  return getSubagentConfiguredModel(input.config, input.subagent.id);
}

export class ScaffoldTaskExecutionBackend implements TaskExecutionBackend {
  readonly id = "scaffold";

  async executeStart(
    input: TaskBackendStartInput,
  ): Promise<SubagentResult<TaskBackendStartOutput, SubagentRuntimeError>> {
    if (input.signal?.aborted) {
      return Result.err(
        new SubagentRuntimeError({
          code: "task_aborted",
          stage: "execute_start",
          message: `Task ${input.taskId} was aborted before execution`,
          meta: { taskId: input.taskId },
        }),
      );
    }

    const summary = `${input.subagent.name}: ${truncate(input.description, 72)}`;
    const output = [
      `subagent: ${input.subagent.id}`,
      `description: ${input.description}`,
      `prompt: ${truncate(input.prompt, 220)}`,
      `backend: ${this.id}`,
      `cwd: ${input.cwd}`,
      `mode: ${input.config.defaultMode}`,
    ].join("\n");

    return Result.ok({
      summary,
      output,
      provider: "unavailable",
      model: "unavailable",
      runtime: this.id,
      route: this.id,
    });
  }

  async executeSend(
    input: TaskBackendSendInput,
  ): Promise<SubagentResult<TaskBackendSendOutput, SubagentRuntimeError>> {
    if (input.signal?.aborted) {
      return Result.err(
        new SubagentRuntimeError({
          code: "task_aborted",
          stage: "execute_send",
          message: `Task ${input.taskId} was aborted before follow-up`,
          meta: { taskId: input.taskId },
        }),
      );
    }

    const summary = `${input.subagent.name} follow-up: ${truncate(input.prompt, 72)}`;
    const output = [
      `subagent: ${input.subagent.id}`,
      `description: ${input.description}`,
      `initial_prompt: ${truncate(input.initialPrompt, 220)}`,
      `follow_up_prompt: ${truncate(input.prompt, 220)}`,
      `follow_up_count: ${input.followUpPrompts.length}`,
      `backend: ${this.id}`,
      `cwd: ${input.cwd}`,
      `mode: ${input.config.defaultMode}`,
    ].join("\n");

    return Result.ok({
      summary,
      output,
      provider: "unavailable",
      model: "unavailable",
      runtime: this.id,
      route: this.id,
    });
  }
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

export function createDefaultTaskExecutionBackend(): TaskExecutionBackend {
  return new PiCliTaskExecutionBackend();
}
