import assert from "node:assert/strict";
import test from "node:test";
import type { OhmRuntimeConfig, OhmSubagentBackend } from "@pi-ohm/config";
import { Result } from "better-result";
import type { OhmSubagentDefinition } from "../catalog";
import {
  createDefaultTaskExecutionBackend,
  PiCliTaskExecutionBackend,
  ScaffoldTaskExecutionBackend,
  type PiCliRunner,
} from "./backend";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

function makeConfig(subagentBackend: OhmSubagentBackend): OhmRuntimeConfig {
  return {
    defaultMode: "smart",
    subagentBackend,
    features: {
      handoff: true,
      subagents: true,
      sessionThreadSearch: true,
      handoffVisualizer: true,
      painterImagegen: false,
    },
    painter: {
      googleNanoBanana: {
        enabled: false,
        model: "",
      },
      openai: {
        enabled: false,
        model: "",
      },
      azureOpenai: {
        enabled: false,
        deployment: "",
        endpoint: "",
        apiVersion: "",
      },
    },
    subagents: {
      taskMaxConcurrency: 3,
      taskRetentionMs: 1000,
      permissions: {
        default: "allow",
        subagents: {},
        allowInternalRouting: false,
      },
    },
  };
}

const subagentFixture: OhmSubagentDefinition = {
  id: "finder",
  name: "Finder",
  summary: "Search specialist",
  whenToUse: ["search"],
  scaffoldPrompt: "search prompt",
};

defineTest("ScaffoldTaskExecutionBackend returns deterministic summary/output", async () => {
  const backend = new ScaffoldTaskExecutionBackend();

  const result = await backend.executeStart({
    taskId: "task_1",
    subagent: subagentFixture,
    description: "Auth flow scan",
    prompt: "Find auth validation path and refresh flow",
    cwd: "/tmp/project",
    config: makeConfig("none"),
    signal: undefined,
  });

  assert.equal(Result.isOk(result), true);
  if (Result.isError(result)) {
    assert.fail("Expected scaffold backend execution to succeed");
  }

  assert.match(result.value.summary, /Finder/);
  assert.match(result.value.summary, /Auth flow scan/);
  assert.match(result.value.output, /subagent: finder/);
  assert.match(result.value.output, /backend: scaffold/);
  assert.match(result.value.output, /mode: smart/);
});

defineTest("ScaffoldTaskExecutionBackend returns deterministic follow-up output", async () => {
  const backend = new ScaffoldTaskExecutionBackend();

  const result = await backend.executeSend({
    taskId: "task_1",
    subagent: subagentFixture,
    description: "Auth flow scan",
    initialPrompt: "Find auth validation path",
    followUpPrompts: ["Now include tests"],
    prompt: "Now include edge-case tests",
    cwd: "/tmp/project",
    config: makeConfig("none"),
    signal: undefined,
  });

  assert.equal(Result.isOk(result), true);
  if (Result.isError(result)) {
    assert.fail("Expected scaffold follow-up execution to succeed");
  }

  assert.match(result.value.summary, /follow-up/);
  assert.match(result.value.output, /initial_prompt:/);
  assert.match(result.value.output, /follow_up_prompt:/);
  assert.match(result.value.output, /follow_up_count: 1/);
});

defineTest("ScaffoldTaskExecutionBackend maps aborted signal to runtime error", async () => {
  const backend = new ScaffoldTaskExecutionBackend();
  const controller = new AbortController();
  controller.abort();

  const result = await backend.executeStart({
    taskId: "task_2",
    subagent: subagentFixture,
    description: "Auth flow scan",
    prompt: "prompt",
    cwd: "/tmp/project",
    config: makeConfig("none"),
    signal: controller.signal,
  });

  assert.equal(Result.isError(result), true);
  if (Result.isOk(result)) {
    assert.fail("Expected aborted signal to produce runtime error");
  }

  assert.equal(result.error.code, "task_aborted");
  assert.equal(result.error.stage, "execute_start");
});

defineTest("ScaffoldTaskExecutionBackend maps aborted send signal to runtime error", async () => {
  const backend = new ScaffoldTaskExecutionBackend();
  const controller = new AbortController();
  controller.abort();

  const result = await backend.executeSend({
    taskId: "task_3",
    subagent: subagentFixture,
    description: "Auth flow scan",
    initialPrompt: "initial",
    followUpPrompts: [],
    prompt: "prompt",
    cwd: "/tmp/project",
    config: makeConfig("none"),
    signal: controller.signal,
  });

  assert.equal(Result.isError(result), true);
  if (Result.isOk(result)) {
    assert.fail("Expected aborted signal to produce runtime error");
  }

  assert.equal(result.error.code, "task_aborted");
  assert.equal(result.error.stage, "execute_send");
});

defineTest(
  "PiCliTaskExecutionBackend executes real backend runner for interactive-shell",
  async () => {
    const prompts: string[] = [];

    const runner: PiCliRunner = async (input) => {
      prompts.push(input.prompt);
      return {
        exitCode: 0,
        stdout: "finder online",
        stderr: "",
        timedOut: false,
        aborted: false,
      };
    };

    const backend = new PiCliTaskExecutionBackend(runner, 1_000);
    const result = await backend.executeStart({
      taskId: "task_4",
      subagent: subagentFixture,
      description: "Auth flow scan",
      prompt: "Find auth validation path and refresh flow",
      cwd: "/tmp/project",
      config: makeConfig("interactive-shell"),
      signal: undefined,
    });

    assert.equal(Result.isOk(result), true);
    if (Result.isError(result)) {
      assert.fail("Expected interactive-shell backend execution to succeed");
    }

    assert.equal(prompts.length, 1);
    assert.match(prompts[0] ?? "", /You are the Finder subagent in Pi OHM/);
    assert.equal(result.value.output, "finder online");
    assert.match(result.value.summary, /Finder: finder online/);
  },
);

defineTest(
  "PiCliTaskExecutionBackend falls back to scaffold mode when backend is none",
  async () => {
    let called = false;

    const runner: PiCliRunner = async () => {
      called = true;
      return {
        exitCode: 0,
        stdout: "should not run",
        stderr: "",
        timedOut: false,
        aborted: false,
      };
    };

    const backend = new PiCliTaskExecutionBackend(runner, 1_000);
    const result = await backend.executeStart({
      taskId: "task_5",
      subagent: subagentFixture,
      description: "Auth flow scan",
      prompt: "Find auth validation path and refresh flow",
      cwd: "/tmp/project",
      config: makeConfig("none"),
      signal: undefined,
    });

    assert.equal(called, false);
    assert.equal(Result.isOk(result), true);
    if (Result.isError(result)) {
      assert.fail("Expected scaffold fallback execution to succeed");
    }

    assert.match(result.value.output, /backend: scaffold/);
  },
);

defineTest("PiCliTaskExecutionBackend reports timeout and backend execution failures", async () => {
  const timeoutRunner: PiCliRunner = async () => ({
    exitCode: 124,
    stdout: "",
    stderr: "",
    timedOut: true,
    aborted: false,
  });

  const timeoutBackend = new PiCliTaskExecutionBackend(timeoutRunner, 1_000);
  const timedOut = await timeoutBackend.executeStart({
    taskId: "task_6",
    subagent: subagentFixture,
    description: "Auth flow scan",
    prompt: "prompt",
    cwd: "/tmp/project",
    config: makeConfig("interactive-shell"),
    signal: undefined,
  });

  assert.equal(Result.isError(timedOut), true);
  if (Result.isOk(timedOut)) {
    assert.fail("Expected timeout error");
  }
  assert.equal(timedOut.error.code, "task_backend_timeout");

  const failureRunner: PiCliRunner = async () => ({
    exitCode: 1,
    stdout: "",
    stderr: "runner exploded",
    timedOut: false,
    aborted: false,
  });

  const failureBackend = new PiCliTaskExecutionBackend(failureRunner, 1_000);
  const failed = await failureBackend.executeStart({
    taskId: "task_7",
    subagent: subagentFixture,
    description: "Auth flow scan",
    prompt: "prompt",
    cwd: "/tmp/project",
    config: makeConfig("interactive-shell"),
    signal: undefined,
  });

  assert.equal(Result.isError(failed), true);
  if (Result.isOk(failed)) {
    assert.fail("Expected backend execution failure");
  }
  assert.equal(failed.error.code, "task_backend_execution_failed");
});

defineTest("PiCliTaskExecutionBackend resolves backend IDs from runtime config", () => {
  const backend = new PiCliTaskExecutionBackend(async () => ({
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    timedOut: false,
    aborted: false,
  }));

  assert.equal(backend.resolveBackendId(makeConfig("interactive-shell")), "interactive-shell");
  assert.equal(backend.resolveBackendId(makeConfig("none")), "scaffold");
  assert.equal(backend.resolveBackendId(makeConfig("custom-plugin")), "custom-plugin");
});

defineTest("createDefaultTaskExecutionBackend defaults to interactive-shell backend", () => {
  const backend = createDefaultTaskExecutionBackend();
  assert.equal(backend.id, "interactive-shell");
});
