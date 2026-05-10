import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const shouldRun = process.env.PI_OHM_RUN_SUBAGENTS_E2E_TEST === "true";
const defaultModel = "openai-codex/gpt-5.4-mini:medium";

void test(
  "subagents e2e: pi print mode spawns a ping subagent",
  { skip: !shouldRun, timeout: 240_000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-subagents-e2e-"));
    const cwd = path.join(root, "project");
    const sessionDir = path.join(root, "sessions");
    const dataHome = path.join(root, "data");
    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.mkdir(dataHome, { recursive: true });

    const extension = path.resolve("packages/subagents/src/extension.ts");
    const model = process.env.PI_OHM_SUBAGENTS_E2E_MODEL ?? defaultModel;
    const prompt = [
      "Use the agent_controller tool to spawn a subagent named ping.",
      "The subagent should only reply pong.",
      "Wait for it, then answer with exactly pong and no other text.",
    ].join(" ");

    const result = await runPi({
      cwd,
      env: {
        ...process.env,
        XDG_DATA_HOME: dataHome,
        PI_OHM_DEBUG_MODE: "true",
        PI_CODING_AGENT_SESSION_DIR: sessionDir,
      },
      args: [
        "-p",
        "--model",
        model,
        "--verbose",
        "--no-extensions",
        "-e",
        extension,
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--no-builtin-tools",
        prompt,
      ],
      timeoutMs: 220_000,
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout.toLowerCase(), /pong/);
  },
);

interface RunPiInput {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

interface RunPiResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runPi(input: RunPiInput): Promise<RunPiResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("pi", input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          [
            `pi e2e timed out after ${input.timeoutMs}ms`,
            "--- stdout ---",
            Buffer.concat(stdout).toString("utf8"),
            "--- stderr ---",
            Buffer.concat(stderr).toString("utf8"),
          ].join("\n"),
        ),
      );
    }, input.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
