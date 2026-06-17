import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Result, type Result as BetterResult } from "better-result";
import { resolveExtensionConfigDir } from "@pi-ohm/core/config";
import { profileStartup, ProfilerError } from "./benchmark";
import { loadProfilerConfig, type ProfilerConfig } from "./config";
import {
  parseMarkedReport,
  renderProfileReport,
  renderStartupLines,
  type ProfileReport,
} from "./report";
import { readLatestReport, writeLatestReport, type ProfilerStoreError } from "./store";

const WIDGET_KEY = "ohm-profiler";
const STATUS_KEY = "ohm-profiler";
const loadedAt = performance.now();
const state: { running?: Promise<void> } = {};

export interface ProfilerCommandContext {
  readonly cwd: string;
  readonly hasUI: boolean;
  readonly ui: {
    editor(title: string, prefill?: string): Promise<string | undefined>;
    notify?(message: string, type?: "info" | "warning" | "error"): void;
  };
}

export interface ProfilerStartupContext extends ProfilerCommandContext {
  readonly ui: ProfilerCommandContext["ui"] & {
    setStatus(key: string, text: string | undefined): void;
    setWidget(
      key: string,
      content: string[] | undefined,
      options?: { readonly placement?: "aboveEditor" | "belowEditor" },
    ): void;
  };
}

export interface RunProfilerProfileInput {
  readonly cwd: string;
  readonly config: ProfilerConfig;
}

export interface RunProfilerDeps {
  readonly profile: (
    input: RunProfilerProfileInput,
  ) => Promise<BetterResult<ProfileReport, ProfilerError>>;
  readonly write: (report: ProfileReport) => Promise<BetterResult<void, ProfilerStoreError>>;
}

function message(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (typeof cause === "string" && cause.trim().length > 0) return cause;
  return String(cause);
}

function cliPath(): string | undefined {
  const js = fileURLToPath(new URL("./cli.js", import.meta.url));
  if (existsSync(js)) return js;
  return undefined;
}

function collectChild(input: {
  readonly child: ReturnType<typeof spawn>;
  readonly timeoutMs: number;
}): Promise<BetterResult<string, ProfilerError>> {
  return new Promise((resolve) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const settled = { value: false };
    const finish = (result: BetterResult<string, ProfilerError>) => {
      if (settled.value) return;
      settled.value = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      input.child.kill("SIGTERM");
      finish(
        Result.err(
          new ProfilerError({
            code: "profile_child_timeout",
            message: `Profiler child timed out after ${input.timeoutMs}ms`,
          }),
        ),
      );
    }, input.timeoutMs);

    const stdoutStream = input.child.stdout;
    const stderrStream = input.child.stderr;
    if (!stdoutStream || !stderrStream) {
      finish(
        Result.err(
          new ProfilerError({
            code: "profile_child_stdio_missing",
            message: "Profiler child did not expose stdout/stderr pipes",
          }),
        ),
      );
      return;
    }

    stdoutStream.on("data", (chunk: Buffer | string) => {
      stdout.push(chunk.toString());
    });
    stderrStream.on("data", (chunk: Buffer | string) => {
      stderr.push(chunk.toString());
    });
    input.child.on("error", (cause) => {
      finish(
        Result.err(
          new ProfilerError({
            code: "profile_child_error",
            message: `Profiler child failed: ${message(cause)}`,
            cause,
          }),
        ),
      );
    });
    input.child.on("close", (code) => {
      if (code === 0) {
        finish(Result.ok(stdout.join("")));
        return;
      }

      finish(
        Result.err(
          new ProfilerError({
            code: "profile_child_failed",
            message: `Profiler child exited with ${code ?? "unknown"}: ${stderr.join("").trim()}`,
          }),
        ),
      );
    });
  });
}

export async function runChildProfile(
  input: RunProfilerProfileInput,
): Promise<BetterResult<ProfileReport, ProfilerError>> {
  const cli = cliPath();
  if (process.env.PI_OHM_PROFILER_INLINE === "1" || !cli) {
    return profileStartup({
      cwd: input.cwd,
      agentDir: resolveExtensionConfigDir(),
      includeLifecycle: input.config.includeLifecycle,
    });
  }

  const args = [cli, "--cwd", input.cwd, "--agent-dir", resolveExtensionConfigDir()];
  if (!input.config.includeLifecycle) args.push("--no-lifecycle");

  const child = Result.try({
    try: () =>
      spawn(process.execPath, args, {
        env: {
          ...process.env,
          PI_OHM_PROFILER_CHILD: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }),
    catch: (cause) =>
      new ProfilerError({
        code: "profile_child_spawn_failed",
        message: `Failed to start profiler child: ${message(cause)}`,
        cause,
      }),
  });
  if (Result.isError(child)) return Result.err(child.error);

  const output = await collectChild({ child: child.value, timeoutMs: input.config.timeoutMs });
  if (Result.isError(output)) return Result.err(output.error);

  const parsed = parseMarkedReport(output.value);
  if (Result.isError(parsed)) {
    return Result.err(
      new ProfilerError({
        code: "profile_child_report_invalid",
        message: parsed.error.message,
        cause: parsed.error,
      }),
    );
  }

  return Result.ok(parsed.value);
}

async function showText(ctx: ProfilerCommandContext, title: string, text: string): Promise<void> {
  if (!ctx.hasUI) {
    console.log(text);
    return;
  }

  await ctx.ui.editor(title, text);
}

function defaultDeps(): RunProfilerDeps {
  return {
    profile: runChildProfile,
    write: writeLatestReport,
  };
}

export async function runProfilerCommand(
  ctx: ProfilerCommandContext,
  deps: RunProfilerDeps = defaultDeps(),
): Promise<void> {
  const loaded = await loadProfilerConfig(ctx.cwd);
  if (Result.isError(loaded)) {
    await showText(ctx, "pi-ohm profiler", loaded.error.message);
    return;
  }

  const report = await deps.profile({ cwd: ctx.cwd, config: loaded.value.config });
  if (Result.isError(report)) {
    await showText(ctx, "pi-ohm profiler", report.error.message);
    ctx.ui.notify?.(report.error.message, "error");
    return;
  }

  const written = await deps.write(report.value);
  if (Result.isError(written)) ctx.ui.notify?.(written.error.message, "error");

  await showText(
    ctx,
    "pi-ohm profiler",
    renderProfileReport(report.value, {
      maxRows: loaded.value.config.maxRows,
      slowThresholdMs: loaded.value.config.slowThresholdMs,
    }),
  );
}

function setStartupWidget(
  ctx: ProfilerStartupContext,
  config: ProfilerConfig,
  report: ProfileReport | undefined,
): void {
  ctx.ui.setWidget(
    WIDGET_KEY,
    [
      ...renderStartupLines(report, {
        maxRows: config.maxRows,
        slowThresholdMs: config.slowThresholdMs,
        currentMs: performance.now() - loadedAt,
      }),
    ],
    { placement: "aboveEditor" },
  );
}

function safeUpdate(update: () => void): void {
  Result.try({ try: update, catch: (cause) => cause });
}

async function refreshProfile(ctx: ProfilerStartupContext, config: ProfilerConfig): Promise<void> {
  safeUpdate(() => ctx.ui.setStatus(STATUS_KEY, "profiler:running"));
  const report = await runChildProfile({ cwd: ctx.cwd, config });

  if (Result.isError(report)) {
    safeUpdate(() => {
      ctx.ui.setStatus(STATUS_KEY, "profiler:error");
      ctx.ui.notify?.(report.error.message, "error");
    });
    return;
  }

  const written = await writeLatestReport(report.value);
  safeUpdate(() => {
    setStartupWidget(ctx, config, report.value);
    ctx.ui.setStatus(
      STATUS_KEY,
      Result.isError(written) ? "profiler:write-error" : "profiler:ready",
    );
  });
}

function queueRefresh(ctx: ProfilerStartupContext, config: ProfilerConfig): void {
  if (state.running) return;
  state.running = refreshProfile(ctx, config).finally(() => {
    state.running = undefined;
  });
}

export async function runProfilerStartup(ctx: ProfilerStartupContext): Promise<void> {
  const loaded = await loadProfilerConfig(ctx.cwd);
  if (Result.isError(loaded)) return;
  const config = loaded.value.config;

  if (!config.enabled) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.setWidget(WIDGET_KEY, undefined, { placement: "aboveEditor" });
    return;
  }

  const latest = await readLatestReport();
  const report = Result.isError(latest) ? undefined : latest.value;
  if (Result.isError(latest)) ctx.ui.notify?.(latest.error.message, "error");

  setStartupWidget(ctx, config, report);
  ctx.ui.setStatus(STATUS_KEY, "profiler:ready");

  if (!config.autoProfile) return;
  if (process.env.PI_OHM_PROFILER_CHILD === "1") return;
  if (report && !isProfileRefreshDue(report, config)) return;

  queueRefresh(ctx, config);
}

function isProfileRefreshDue(report: ProfileReport, config: ProfilerConfig): boolean {
  const generatedAt = new Date(report.generatedAt).getTime();
  if (Number.isNaN(generatedAt)) return true;
  return Date.now() - generatedAt > config.staleAfterMs;
}

export default function registerProfilerExtension(
  pi: Pick<ExtensionAPI, "on" | "registerCommand">,
): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    await runProfilerStartup(ctx);
  });

  pi.registerCommand("ohm-profiler", {
    description: "Profile Pi extension startup time",
    handler: async (_args, ctx) => {
      await runProfilerCommand(ctx);
    },
  });
}
