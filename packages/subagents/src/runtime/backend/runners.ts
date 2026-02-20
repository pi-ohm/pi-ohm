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
import {
  applyPiSdkSessionEvent,
  createPiSdkStreamCaptureState,
  finalizePiSdkStreamCapture,
} from "./sdk-stream-capture";
import { parseSubagentModelSelection } from "./model-selection";
import type {
  PiCliRunner,
  PiCliRunnerInput,
  PiCliRunnerResult,
  PiSdkRunner,
  PiSdkRunnerInput,
  PiSdkRunnerResult,
} from "./types";

export function normalizeOutput(stdout: string, stderr: string): string {
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

export function sanitizeNestedOutput(output: string): NestedOutputNormalization {
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

export const PI_CLI_TOOLS = "read,bash,edit,write,grep,find,ls";
export const SDK_BACKEND_RUNTIME = "pi-sdk";
export const SDK_BACKEND_ROUTE = "interactive-sdk";
export const CLI_BACKEND_ROUTE = "interactive-shell";

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

export function normalizeRunnerOutput(output: string): string {
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
