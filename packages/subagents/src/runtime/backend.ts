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
import { Result } from "better-result";
import type { OhmRuntimeConfig } from "@pi-ohm/config";
import type { OhmSubagentDefinition } from "../catalog";
import { SubagentRuntimeError, type SubagentResult } from "../errors";

export interface TaskBackendStartInput {
  readonly taskId: string;
  readonly subagent: OhmSubagentDefinition;
  readonly description: string;
  readonly prompt: string;
  readonly config: OhmRuntimeConfig;
  readonly cwd: string;
  readonly signal: AbortSignal | undefined;
}

export interface TaskBackendStartOutput {
  readonly summary: string;
  readonly output: string;
  readonly provider?: string;
  readonly model?: string;
  readonly runtime?: string;
  readonly route?: string;
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
}

export interface TaskBackendSendOutput {
  readonly summary: string;
  readonly output: string;
  readonly provider?: string;
  readonly model?: string;
  readonly runtime?: string;
  readonly route?: string;
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

function getTimeoutMsFromEnv(): number {
  const raw = process.env.OHM_SUBAGENTS_BACKEND_TIMEOUT_MS;
  if (!raw) return 180_000;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 180_000;
  return parsed;
}

export interface PiCliRunnerInput {
  readonly cwd: string;
  readonly prompt: string;
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
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
}

export interface PiSdkRunnerResult {
  readonly output: string;
  readonly provider?: string;
  readonly model?: string;
  readonly runtime?: string;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly error?: string;
}

export type PiSdkRunner = (input: PiSdkRunnerInput) => Promise<PiSdkRunnerResult>;

const PI_CLI_TOOLS = "read,bash,edit,write,grep,find,ls";
const SDK_BACKEND_RUNTIME = "pi-sdk";

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
      timedOut: false,
      aborted: true,
    };
  }

  const outputChunks: string[] = [];
  let timedOut = false;
  let aborted = false;
  let errorText: string | undefined;
  let session:
    | {
        readonly prompt: (prompt: string) => Promise<void>;
        readonly subscribe: (
          listener: (event: {
            readonly type: string;
            readonly assistantMessageEvent?: {
              readonly type: string;
              readonly delta?: string;
            };
          }) => void,
        ) => () => void;
        readonly abort: () => Promise<void>;
        readonly dispose: () => void;
      }
    | undefined;

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
  } catch (error) {
    return {
      output: "",
      timedOut: false,
      aborted: false,
      error: toErrorMessage(error),
    };
  }

  const unsubscribe = session.subscribe((event) => {
    if (event.type !== "message_update") return;
    const assistantMessageEvent = event.assistantMessageEvent;
    if (!assistantMessageEvent) return;
    if (assistantMessageEvent.type !== "text_delta") return;
    if (typeof assistantMessageEvent.delta !== "string") return;

    outputChunks.push(assistantMessageEvent.delta);
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
      timedOut: false,
      aborted: true,
    };
  }

  if (timedOut) {
    return {
      output: "",
      timedOut: true,
      aborted: false,
    };
  }

  if (errorText) {
    return {
      output: "",
      timedOut: false,
      aborted: false,
      error: errorText,
    };
  }

  return {
    output: normalizeRunnerOutput(outputChunks.join("")),
    provider: "unavailable",
    model: "unavailable",
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
    const args = [
      "--print",
      "--no-session",
      "--no-extensions",
      "--tools",
      PI_CLI_TOOLS,
      input.prompt,
    ];

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

function toBackendTimeoutError(taskId: string, stage: "execute_start" | "execute_send") {
  return new SubagentRuntimeError({
    code: "task_backend_timeout",
    stage,
    message: `Task ${taskId} timed out while waiting for subagent backend response`,
    meta: { taskId },
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
  readonly id = "interactive-shell";
  private readonly scaffoldBackend = new ScaffoldTaskExecutionBackend();

  constructor(
    private readonly runner: PiCliRunner = runPiCliPrompt,
    private readonly timeoutMs: number = getTimeoutMsFromEnv(),
    private readonly sdkBackend: TaskExecutionBackend = new PiSdkTaskExecutionBackend(),
  ) {}

  resolveBackendId(config: OhmRuntimeConfig): string {
    if (config.subagentBackend === "none") return this.scaffoldBackend.id;
    if (config.subagentBackend === "interactive-sdk") return "interactive-sdk";
    if (config.subagentBackend === "custom-plugin") return "custom-plugin";
    return this.id;
  }

  async executeStart(
    input: TaskBackendStartInput,
  ): Promise<SubagentResult<TaskBackendStartOutput, SubagentRuntimeError>> {
    if (input.signal?.aborted) {
      return Result.err(toAbortedError(input.taskId, "execute_start"));
    }

    if (input.config.subagentBackend === "interactive-sdk") {
      return this.sdkBackend.executeStart(input);
    }

    if (input.config.subagentBackend === "none") {
      return this.scaffoldBackend.executeStart(input);
    }

    if (input.config.subagentBackend === "custom-plugin") {
      return Result.err(toUnsupportedBackendError(input.taskId, "execute_start"));
    }

    const run = await this.runner({
      cwd: input.cwd,
      prompt: buildStartPrompt(input),
      signal: input.signal,
      timeoutMs: this.timeoutMs,
    });

    if (run.aborted || input.signal?.aborted) {
      return Result.err(toAbortedError(input.taskId, "execute_start"));
    }

    if (run.timedOut) {
      return Result.err(toBackendTimeoutError(input.taskId, "execute_start"));
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
      route: this.id,
    });
  }

  async executeSend(
    input: TaskBackendSendInput,
  ): Promise<SubagentResult<TaskBackendSendOutput, SubagentRuntimeError>> {
    if (input.signal?.aborted) {
      return Result.err(toAbortedError(input.taskId, "execute_send"));
    }

    if (input.config.subagentBackend === "interactive-sdk") {
      return this.sdkBackend.executeSend(input);
    }

    if (input.config.subagentBackend === "none") {
      return this.scaffoldBackend.executeSend(input);
    }

    if (input.config.subagentBackend === "custom-plugin") {
      return Result.err(toUnsupportedBackendError(input.taskId, "execute_send"));
    }

    const run = await this.runner({
      cwd: input.cwd,
      prompt: buildSendPrompt(input),
      signal: input.signal,
      timeoutMs: this.timeoutMs,
    });

    if (run.aborted || input.signal?.aborted) {
      return Result.err(toAbortedError(input.taskId, "execute_send"));
    }

    if (run.timedOut) {
      return Result.err(toBackendTimeoutError(input.taskId, "execute_send"));
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
      route: this.id,
    });
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

    const run = await this.runner({
      cwd: input.cwd,
      prompt: buildStartPrompt(input),
      signal: input.signal,
      timeoutMs: this.timeoutMs,
    });

    if (run.aborted || input.signal?.aborted) {
      return Result.err(toAbortedError(input.taskId, "execute_start"));
    }

    if (run.timedOut) {
      return Result.err(toBackendTimeoutError(input.taskId, "execute_start"));
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
      route: this.id,
    });
  }

  async executeSend(
    input: TaskBackendSendInput,
  ): Promise<SubagentResult<TaskBackendSendOutput, SubagentRuntimeError>> {
    if (input.signal?.aborted) {
      return Result.err(toAbortedError(input.taskId, "execute_send"));
    }

    const run = await this.runner({
      cwd: input.cwd,
      prompt: buildSendPrompt(input),
      signal: input.signal,
      timeoutMs: this.timeoutMs,
    });

    if (run.aborted || input.signal?.aborted) {
      return Result.err(toAbortedError(input.taskId, "execute_send"));
    }

    if (run.timedOut) {
      return Result.err(toBackendTimeoutError(input.taskId, "execute_send"));
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
      route: this.id,
    });
  }
}

export function createDefaultTaskExecutionBackend(): TaskExecutionBackend {
  return new PiCliTaskExecutionBackend();
}
