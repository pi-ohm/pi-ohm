import assert from "node:assert/strict";
import test from "node:test";
import type { OhmRuntimeConfig, OhmSubagentBackend } from "@pi-ohm/config";
import { Result } from "better-result";
import type { OhmSubagentDefinition } from "../catalog";
import { SubagentRuntimeError } from "../errors";
import {
  applyPiSdkSessionEvent,
  createDefaultTaskExecutionBackend,
  createPiSdkStreamCaptureState,
  finalizePiSdkStreamCapture,
  PiCliTaskExecutionBackend,
  PiSdkTaskExecutionBackend,
  ScaffoldTaskExecutionBackend,
  type PiCliRunner,
  type PiSdkRunner,
  type TaskExecutionBackend,
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
    assert.match(result.value.summary, /Finder: Auth flow scan/);
    assert.equal(result.value.runtime, "pi-cli");
    assert.equal(result.value.route, "interactive-shell");
    assert.equal(result.value.provider, "unavailable");
    assert.equal(result.value.model, "unavailable");
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

defineTest(
  "PiCliTaskExecutionBackend strips backend/provider/model metadata lines from nested output",
  async () => {
    const runner: PiCliRunner = async () => ({
      exitCode: 0,
      stdout: [
        "backend: pi-coding-agent",
        "provider: openai-codex",
        "model: gpt-5.3-codex",
        "",
        "actual line one",
        "actual line two",
      ].join("\n"),
      stderr: "",
      timedOut: false,
      aborted: false,
    });

    const backend = new PiCliTaskExecutionBackend(runner, 1_000);
    const result = await backend.executeStart({
      taskId: "task_9",
      subagent: subagentFixture,
      description: "Auth flow scan",
      prompt: "Find auth validation path and refresh flow",
      cwd: "/tmp/project",
      config: makeConfig("interactive-shell"),
      signal: undefined,
    });

    assert.equal(Result.isOk(result), true);
    if (Result.isError(result)) {
      assert.fail("Expected sanitized output success");
    }

    assert.doesNotMatch(result.value.output, /^backend:/m);
    assert.doesNotMatch(result.value.output, /^provider:/m);
    assert.doesNotMatch(result.value.output, /^model:/m);
    assert.match(result.value.output, /actual line one/);
    assert.match(result.value.output, /actual line two/);
    assert.equal(result.value.provider, "openai-codex");
    assert.equal(result.value.model, "gpt-5.3-codex");
    assert.equal(result.value.runtime, "pi-coding-agent");
    assert.equal(result.value.route, "interactive-shell");
  },
);

defineTest("PiSdkTaskExecutionBackend executes sdk runner for interactive-sdk", async () => {
  const prompts: string[] = [];

  const runner: PiSdkRunner = async (input) => {
    prompts.push(input.prompt);
    return {
      output: "sdk online",
      events: [],
      provider: "sdk-provider",
      model: "sdk-model",
      runtime: "pi-sdk",
      timedOut: false,
      aborted: false,
    };
  };

  const backend = new PiSdkTaskExecutionBackend(runner, 1_000);
  const result = await backend.executeStart({
    taskId: "task_sdk_1",
    subagent: subagentFixture,
    description: "Auth flow scan",
    prompt: "Trace auth validation path",
    cwd: "/tmp/project",
    config: makeConfig("interactive-sdk"),
    signal: undefined,
  });

  assert.equal(Result.isOk(result), true);
  if (Result.isError(result)) {
    assert.fail("Expected interactive-sdk backend execution to succeed");
  }

  assert.equal(prompts.length, 1);
  assert.match(prompts[0] ?? "", /You are the Finder subagent in Pi OHM/);
  assert.equal(result.value.output, "sdk online");
  assert.equal(result.value.provider, "sdk-provider");
  assert.equal(result.value.model, "sdk-model");
  assert.equal(result.value.runtime, "pi-sdk");
  assert.equal(result.value.route, "interactive-sdk");
});

defineTest("Pi SDK stream capture records tool lifecycle and assistant deltas", () => {
  const capture = createPiSdkStreamCaptureState();

  applyPiSdkSessionEvent(capture, {
    type: "tool_execution_start",
    toolCallId: "tool_1",
    toolName: "read",
    args: { path: "src/index.ts" },
  });
  applyPiSdkSessionEvent(capture, {
    type: "tool_execution_update",
    toolCallId: "tool_1",
    toolName: "read",
    partialResult: { progress: "50%" },
  });
  applyPiSdkSessionEvent(capture, {
    type: "tool_execution_end",
    toolCallId: "tool_1",
    toolName: "read",
    result: { ok: true },
    isError: false,
  });
  applyPiSdkSessionEvent(capture, {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "Found auth flow." },
  });
  applyPiSdkSessionEvent(capture, {
    type: "agent_end",
  });

  const finalized = finalizePiSdkStreamCapture(capture);
  assert.equal(finalized.sawAgentEnd, true);
  assert.equal(finalized.capturedEventCount, 5);
  assert.match(finalized.output, /tool_call: read start/);
  assert.match(finalized.output, /tool_call: read update/);
  assert.match(finalized.output, /tool_call: read end success/);
  assert.match(finalized.output, /Found auth flow\./);
});

defineTest("Pi SDK stream capture ignores unsupported events", () => {
  const capture = createPiSdkStreamCaptureState();

  applyPiSdkSessionEvent(capture, { type: "turn_start", turnIndex: 1 });
  applyPiSdkSessionEvent(capture, {
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "..." },
  });
  applyPiSdkSessionEvent(capture, {
    type: "tool_execution_start",
    toolCallId: "tool_1",
    toolName: "bash",
    args: undefined,
  });

  const finalized = finalizePiSdkStreamCapture(capture);
  assert.equal(finalized.capturedEventCount, 1);
  assert.equal(finalized.sawAgentEnd, false);
  assert.match(finalized.output, /tool_call: bash start/);
});

defineTest("PiSdkTaskExecutionBackend maps timeout/abort/execution failures", async () => {
  const timeoutBackend = new PiSdkTaskExecutionBackend(async () => ({
    output: "",
    events: [],
    timedOut: true,
    aborted: false,
  }));

  const timedOut = await timeoutBackend.executeStart({
    taskId: "task_sdk_timeout",
    subagent: subagentFixture,
    description: "timeout",
    prompt: "timeout",
    cwd: "/tmp/project",
    config: makeConfig("interactive-sdk"),
    signal: undefined,
  });

  assert.equal(Result.isError(timedOut), true);
  if (Result.isOk(timedOut)) {
    assert.fail("Expected timeout error");
  }
  assert.equal(timedOut.error.code, "task_backend_timeout");

  const abortedBackend = new PiSdkTaskExecutionBackend(async () => ({
    output: "",
    events: [],
    timedOut: false,
    aborted: true,
  }));

  const aborted = await abortedBackend.executeStart({
    taskId: "task_sdk_abort",
    subagent: subagentFixture,
    description: "abort",
    prompt: "abort",
    cwd: "/tmp/project",
    config: makeConfig("interactive-sdk"),
    signal: undefined,
  });

  assert.equal(Result.isError(aborted), true);
  if (Result.isOk(aborted)) {
    assert.fail("Expected aborted error");
  }
  assert.equal(aborted.error.code, "task_aborted");

  const failedBackend = new PiSdkTaskExecutionBackend(async () => ({
    output: "",
    events: [],
    timedOut: false,
    aborted: false,
    error: "sdk failed",
  }));

  const failed = await failedBackend.executeSend({
    taskId: "task_sdk_fail",
    subagent: subagentFixture,
    description: "failure",
    initialPrompt: "initial",
    followUpPrompts: [],
    prompt: "follow-up",
    cwd: "/tmp/project",
    config: makeConfig("interactive-sdk"),
    signal: undefined,
  });

  assert.equal(Result.isError(failed), true);
  if (Result.isOk(failed)) {
    assert.fail("Expected execution failure");
  }
  assert.equal(failed.error.code, "task_backend_execution_failed");
});

defineTest("PiCliTaskExecutionBackend delegates to sdk backend when configured", async () => {
  let cliCalled = false;

  const cliRunner: PiCliRunner = async () => {
    cliCalled = true;
    return {
      exitCode: 0,
      stdout: "cli output",
      stderr: "",
      timedOut: false,
      aborted: false,
    };
  };

  const sdkBackend: TaskExecutionBackend = {
    id: "interactive-sdk",
    async executeStart() {
      return Result.ok({
        summary: "Finder: via sdk",
        output: "sdk output",
        provider: "sdk-provider",
        model: "sdk-model",
        runtime: "pi-sdk",
        route: "interactive-sdk",
      });
    },
    async executeSend() {
      return Result.ok({
        summary: "Finder follow-up: via sdk",
        output: "sdk follow-up output",
        provider: "sdk-provider",
        model: "sdk-model",
        runtime: "pi-sdk",
        route: "interactive-sdk",
      });
    },
  };

  const backend = new PiCliTaskExecutionBackend(cliRunner, 1_000, sdkBackend);
  const result = await backend.executeStart({
    taskId: "task_sdk_2",
    subagent: subagentFixture,
    description: "Auth flow scan",
    prompt: "Trace auth validation path",
    cwd: "/tmp/project",
    config: makeConfig("interactive-sdk"),
    signal: undefined,
  });

  assert.equal(cliCalled, false);
  assert.equal(Result.isOk(result), true);
  if (Result.isError(result)) {
    assert.fail("Expected sdk delegation to succeed");
  }

  assert.equal(result.value.output, "sdk output");
  assert.equal(result.value.route, "interactive-sdk");
});

defineTest(
  "PiCliTaskExecutionBackend falls back to cli when sdk fails and fallback is enabled",
  async () => {
    const previous = process.env.OHM_SUBAGENTS_SDK_FALLBACK_TO_CLI;
    process.env.OHM_SUBAGENTS_SDK_FALLBACK_TO_CLI = "true";

    try {
      let cliCalls = 0;
      const cliRunner: PiCliRunner = async () => {
        cliCalls += 1;
        return {
          exitCode: 0,
          stdout: "cli fallback output",
          stderr: "",
          timedOut: false,
          aborted: false,
        };
      };

      const sdkBackend: TaskExecutionBackend = {
        id: "interactive-sdk",
        async executeStart() {
          return Result.err(
            new SubagentRuntimeError({
              code: "task_backend_execution_failed",
              stage: "execute_start",
              message: "sdk bootstrap failed",
            }),
          );
        },
        async executeSend() {
          return Result.err(
            new SubagentRuntimeError({
              code: "task_backend_execution_failed",
              stage: "execute_send",
              message: "sdk bootstrap failed",
            }),
          );
        },
      };

      const backend = new PiCliTaskExecutionBackend(cliRunner, 1_000, sdkBackend);
      const result = await backend.executeStart({
        taskId: "task_sdk_fallback",
        subagent: subagentFixture,
        description: "Fallback run",
        prompt: "Use cli fallback",
        cwd: "/tmp/project",
        config: makeConfig("interactive-sdk"),
        signal: undefined,
      });

      assert.equal(Result.isOk(result), true);
      if (Result.isError(result)) {
        assert.fail("Expected sdk->cli fallback success");
      }

      assert.equal(cliCalls, 1);
      assert.equal(result.value.output, "cli fallback output");
      assert.equal(result.value.route, "interactive-shell");
    } finally {
      if (previous === undefined) {
        delete process.env.OHM_SUBAGENTS_SDK_FALLBACK_TO_CLI;
      } else {
        process.env.OHM_SUBAGENTS_SDK_FALLBACK_TO_CLI = previous;
      }
    }
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
  assert.equal(backend.resolveBackendId(makeConfig("interactive-sdk")), "interactive-sdk");
  assert.equal(backend.resolveBackendId(makeConfig("none")), "scaffold");
  assert.equal(backend.resolveBackendId(makeConfig("custom-plugin")), "custom-plugin");
});

defineTest("createDefaultTaskExecutionBackend defaults to interactive-shell backend", () => {
  const backend = createDefaultTaskExecutionBackend();
  assert.equal(backend.id, "interactive-shell");
});
