import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { LoadedOhmRuntimeConfig, OhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import type { OhmSubagentDefinition } from "../catalog";
import { SubagentRuntimeError } from "../errors";
import type {
  TaskBackendSendInput,
  TaskBackendStartInput,
  TaskExecutionBackend,
} from "../runtime/backend";
import { createInMemoryTaskRuntimeStore } from "../runtime/tasks";
import {
  createTaskId,
  formatTaskToolCall,
  formatTaskToolResult,
  registerTaskTool,
  runTaskToolMvp,
  type TaskToolDependencies,
} from "./task";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

const runtimeSubagentsFixture = {
  taskMaxConcurrency: 2,
  taskRetentionMs: 1000 * 60 * 60,
  permissions: {
    default: "allow",
    subagents: {},
    allowInternalRouting: false,
  },
} as const;

const runtimeConfigFixture: OhmRuntimeConfig = {
  defaultMode: "smart",
  subagentBackend: "none",
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
  subagents: runtimeSubagentsFixture,
};

const loadedConfigFixture: LoadedOhmRuntimeConfig = {
  config: runtimeConfigFixture,
  paths: {
    configDir: "/tmp/.pi/agent",
    globalConfigFile: "/tmp/.pi/agent/ohm.json",
    projectConfigFile: "/tmp/project/.pi/ohm.json",
    providersConfigFile: "/tmp/.pi/agent/ohm.providers.json",
  },
  loadedFrom: [],
};

const finderSubagentFixture: OhmSubagentDefinition = {
  id: "finder",
  name: "Finder",
  summary: "Search specialist",
  whenToUse: ["search"],
  scaffoldPrompt: "search prompt",
};

class SuccessfulBackend implements TaskExecutionBackend {
  readonly id = "test-backend";

  async executeStart() {
    return Result.ok({
      summary: "Finder: Auth flow scan",
      output: "Detailed task output",
    });
  }

  async executeSend() {
    return Result.ok({
      summary: "Finder follow-up: include tests",
      output: "Follow-up output",
    });
  }
}

class FailingBackend implements TaskExecutionBackend {
  readonly id = "test-backend";

  async executeStart() {
    return Result.err(
      new SubagentRuntimeError({
        code: "backend_failed",
        stage: "execute_start",
        message: "backend execution failed",
      }),
    );
  }

  async executeSend() {
    return Result.err(
      new SubagentRuntimeError({
        code: "backend_send_failed",
        stage: "execute_send",
        message: "backend follow-up failed",
      }),
    );
  }
}

interface PendingCall {
  readonly input: TaskBackendStartInput;
  readonly resolve: (
    result: Result<
      {
        readonly summary: string;
        readonly output: string;
      },
      SubagentRuntimeError
    >,
  ) => void;
}

class DeferredBackend implements TaskExecutionBackend {
  readonly id = "deferred-backend";
  readonly calls: PendingCall[] = [];
  readonly sendCalls: TaskBackendSendInput[] = [];

  async executeStart(input: TaskBackendStartInput): Promise<
    Result<
      {
        readonly summary: string;
        readonly output: string;
      },
      SubagentRuntimeError
    >
  > {
    return new Promise((resolve) => {
      this.calls.push({ input, resolve });
    });
  }

  async executeSend(input: TaskBackendSendInput) {
    this.sendCalls.push(input);
    return Result.ok({
      summary: `Finder follow-up: ${input.prompt}`,
      output: `follow_up_prompt: ${input.prompt}`,
    });
  }

  resolveSuccess(index: number, summary: string, output: string): void {
    const call = this.calls[index];
    if (!call) {
      throw new Error(`No deferred call at index ${index}`);
    }

    call.resolve(Result.ok({ summary, output }));
  }

  resolveFailure(index: number, code: string, message: string): void {
    const call = this.calls[index];
    if (!call) {
      throw new Error(`No deferred call at index ${index}`);
    }

    call.resolve(
      Result.err(
        new SubagentRuntimeError({
          code,
          stage: "execute_start",
          message,
        }),
      ),
    );
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

class CountingBackend implements TaskExecutionBackend {
  readonly id = "counting-backend";
  inFlight = 0;
  maxInFlight = 0;

  async executeStart(input: TaskBackendStartInput) {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);

    const delay = input.description.includes("slow")
      ? 35
      : input.description.includes("medium")
        ? 20
        : 8;

    await sleep(delay);
    this.inFlight -= 1;

    if (input.description.includes("fail")) {
      return Result.err(
        new SubagentRuntimeError({
          code: "backend_failed",
          stage: "execute_start",
          message: `forced failure for ${input.description}`,
        }),
      );
    }

    return Result.ok({
      summary: `Finder: ${input.description}`,
      output: `output for ${input.description}`,
    });
  }

  async executeSend(input: TaskBackendSendInput) {
    return Result.ok({
      summary: `Finder follow-up: ${input.prompt}`,
      output: `follow-up output for ${input.prompt}`,
    });
  }
}

function makeDeps(overrides: Partial<TaskToolDependencies> = {}): TaskToolDependencies {
  let sequence = 0;

  return {
    loadConfig: async () => loadedConfigFixture,
    backend: new SuccessfulBackend(),
    findSubagentById: (id) => (id === "finder" ? finderSubagentFixture : undefined),
    subagents: [finderSubagentFixture],
    createTaskId: () => {
      sequence += 1;
      return `task_test_${String(sequence).padStart(4, "0")}`;
    },
    taskStore: createInMemoryTaskRuntimeStore(),
    ...overrides,
  };
}

async function runTask(
  input: Omit<Parameters<typeof runTaskToolMvp>[0], "hasUI" | "ui">,
): Promise<Awaited<ReturnType<typeof runTaskToolMvp>>> {
  return runTaskToolMvp({
    ...input,
    hasUI: false,
    ui: undefined,
  });
}

defineTest("createTaskId creates deterministic prefixed IDs", () => {
  const taskId = createTaskId(1700000000000);
  assert.match(taskId, /^task_1700000000000_\d{4}$/);
});

defineTest("formatTaskToolCall supports start/status/wait/send/cancel", () => {
  assert.equal(
    formatTaskToolCall({
      op: "start",
      subagent_type: "finder",
      description: "Auth flow scan",
      prompt: "Trace auth",
      async: true,
    }),
    "task start finder · Auth flow scan async",
  );

  assert.equal(
    formatTaskToolCall({
      op: "status",
      ids: ["task_1"],
    }),
    "task status",
  );

  assert.equal(
    formatTaskToolCall({
      op: "wait",
      ids: ["task_1"],
      timeout_ms: 250,
    }),
    "task wait",
  );

  assert.equal(
    formatTaskToolCall({
      op: "send",
      id: "task_1",
      prompt: "continue",
    }),
    "task send",
  );

  assert.equal(
    formatTaskToolCall({
      op: "cancel",
      id: "task_1",
    }),
    "task cancel",
  );
});

defineTest("formatTaskToolResult renders collection items", () => {
  const compact = formatTaskToolResult(
    {
      op: "status",
      status: "running",
      summary: "status for 2 task(s)",
      backend: "test-backend",
      items: [
        {
          id: "task_1",
          found: true,
          status: "running",
          subagent_type: "finder",
          description: "Auth flow scan",
          summary: "Starting Finder: Auth flow scan",
        },
        {
          id: "task_missing",
          found: false,
          summary: "Unknown task id",
          error_code: "unknown_task_id",
          error_message: "Unknown task id",
        },
      ],
    },
    false,
  );

  assert.match(compact, /items:/);
  assert.match(compact, /task_1: running finder/);
  assert.match(compact, /task_missing: unknown/);
});

defineTest("formatTaskToolResult preserves multiline output in compact text", () => {
  const compact = formatTaskToolResult(
    {
      op: "start",
      status: "succeeded",
      task_id: "task_1",
      subagent_type: "finder",
      description: "Auth flow scan",
      summary: "Finder: Auth flow scan",
      output: "line one\nline two\nline three",
      output_available: true,
      backend: "test-backend",
    },
    false,
  );

  assert.match(compact, /output:/);
  assert.match(compact, /line one/);
  assert.match(compact, /line two/);
  assert.match(compact, /line three/);
});

defineTest("runTaskToolMvp returns validation failure for malformed payload", async () => {
  const result = await runTask({
    params: { op: "start", prompt: "missing fields" },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps: makeDeps(),
  });

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.error_code, "invalid_task_tool_payload");
  assert.equal(result.details.error_category, "validation");
});

defineTest("runTaskToolMvp normalizes wait id alias + extra fields", async () => {
  const waited = await runTask({
    params: {
      op: "wait",
      id: "task_missing_1",
      subagent_type: "finder",
      description: "ignored",
      timeout_ms: 50,
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps: makeDeps(),
  });

  assert.equal(waited.details.op, "wait");
  assert.equal(waited.details.status, "failed");
  assert.equal(waited.details.items?.[0]?.error_code, "unknown_task_id");
  assert.equal(waited.details.items?.[0]?.error_category, "runtime");
});

defineTest("runTaskToolMvp maps result op alias to status", async () => {
  const status = await runTask({
    params: {
      op: "result",
      id: "task_missing_2",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps: makeDeps(),
  });

  assert.equal(status.details.op, "status");
  assert.equal(status.details.status, "failed");
  assert.equal(status.details.items?.[0]?.error_code, "unknown_task_id");
});

defineTest("runTaskToolMvp returns explicit unsupported-op response for help", async () => {
  const result = await runTask({
    params: { op: "help" },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps: makeDeps(),
  });

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.error_code, "task_operation_not_supported");
  assert.equal(result.details.error_category, "runtime");
});

defineTest("runTaskToolMvp handles sync start success", async () => {
  const updates: string[] = [];

  const result = await runTask({
    params: {
      op: "start",
      subagent_type: "finder",
      description: "Auth flow scan",
      prompt: "Trace auth validation",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: (partial) => {
      updates.push(partial.details.status);
    },
    deps: makeDeps(),
  });

  assert.deepEqual(updates, ["running", "succeeded"]);
  assert.equal(result.details.status, "succeeded");
  assert.equal(result.details.task_id, "task_test_0001");
  assert.equal(result.details.subagent_type, "finder");
  assert.equal(result.details.backend, "test-backend");
  assert.match(result.details.summary, /Finder/);
});

defineTest("runTaskToolMvp surfaces multiline output text in tool content", async () => {
  const deps = makeDeps({
    backend: {
      id: "multiline-backend",
      async executeStart() {
        return Result.ok({
          summary: "Finder: multiline",
          output: "alpha\nbeta\ngamma",
        });
      },
      async executeSend() {
        return Result.ok({
          summary: "Finder follow-up",
          output: "follow-up",
        });
      },
    },
  });

  const result = await runTask({
    params: {
      op: "start",
      subagent_type: "finder",
      description: "Multiline",
      prompt: "Return multiple lines",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  const textBlock = result.content.find((part) => part.type === "text");
  assert.notEqual(textBlock, undefined);
  if (!textBlock || textBlock.type !== "text") {
    assert.fail("Expected text content block");
  }

  assert.match(textBlock.text, /output:/);
  assert.match(textBlock.text, /alpha/);
  assert.match(textBlock.text, /beta/);
  assert.match(textBlock.text, /gamma/);
});

defineTest("runTaskToolMvp handles async start and status lifecycle", async () => {
  const backend = new DeferredBackend();
  const deps = makeDeps({ backend });

  const started = await runTask({
    params: {
      op: "start",
      async: true,
      subagent_type: "finder",
      description: "Auth flow scan",
      prompt: "Trace auth validation",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(started.details.status, "running");
  assert.equal(started.details.task_id, "task_test_0001");
  assert.equal(backend.calls.length, 1);

  const statusBefore = await runTask({
    params: {
      op: "status",
      ids: ["task_test_0001"],
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(statusBefore.details.op, "status");
  assert.equal(statusBefore.details.status, "running");
  assert.equal(statusBefore.details.items?.[0]?.status, "running");

  backend.resolveSuccess(0, "Finder: Auth flow scan", "done output");
  await Promise.resolve();
  await Promise.resolve();

  const statusAfter = await runTask({
    params: {
      op: "status",
      ids: ["task_test_0001"],
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(statusAfter.details.status, "succeeded");
  assert.equal(statusAfter.details.items?.[0]?.status, "succeeded");
});

defineTest("runTaskToolMvp wait returns timeout for unfinished tasks", async () => {
  const backend = new DeferredBackend();
  const deps = makeDeps({ backend });

  const started = await runTask({
    params: {
      op: "start",
      async: true,
      subagent_type: "finder",
      description: "Auth flow scan",
      prompt: "Trace auth validation",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(started.details.status, "running");

  const waited = await runTask({
    params: {
      op: "wait",
      ids: ["task_test_0001"],
      timeout_ms: 30,
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(waited.details.op, "wait");
  assert.equal(waited.details.timed_out, true);
  assert.equal(waited.details.status, "running");
  assert.equal(waited.details.error_code, "task_wait_timeout");
  assert.equal(waited.details.error_category, "runtime");

  backend.resolveSuccess(0, "Finder: Auth flow scan", "done output");
  await Promise.resolve();
  await Promise.resolve();

  const waitedAfter = await runTask({
    params: {
      op: "wait",
      ids: ["task_test_0001"],
      timeout_ms: 100,
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(waitedAfter.details.timed_out, false);
  assert.equal(waitedAfter.details.status, "succeeded");
});

defineTest("runTaskToolMvp status/wait include terminal outputs for async tasks", async () => {
  const backend = new DeferredBackend();
  const deps = makeDeps({ backend });

  const started = await runTask({
    params: {
      op: "start",
      async: true,
      subagent_type: "finder",
      description: "Auth flow scan",
      prompt: "Trace auth validation",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(started.details.status, "running");

  backend.resolveSuccess(0, "Finder: Auth flow scan", "line1\nline2\nline3");
  await Promise.resolve();
  await Promise.resolve();

  const waited = await runTask({
    params: {
      op: "wait",
      ids: ["task_test_0001"],
      timeout_ms: 100,
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  const waitedItem = waited.details.items?.[0];
  assert.notEqual(waitedItem, undefined);
  if (!waitedItem) {
    assert.fail("Expected wait item");
  }

  assert.equal(Reflect.get(waitedItem, "output_available"), true);
  assert.equal(Reflect.get(waitedItem, "output"), "line1\nline2\nline3");

  const status = await runTask({
    params: {
      op: "status",
      ids: ["task_test_0001"],
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  const statusItem = status.details.items?.[0];
  assert.notEqual(statusItem, undefined);
  if (!statusItem) {
    assert.fail("Expected status item");
  }

  assert.equal(Reflect.get(statusItem, "output_available"), true);
  assert.equal(Reflect.get(statusItem, "output"), "line1\nline2\nline3");
});

defineTest("runTaskToolMvp send resumes running task", async () => {
  const backend = new DeferredBackend();
  const deps = makeDeps({ backend });

  const started = await runTask({
    params: {
      op: "start",
      async: true,
      subagent_type: "finder",
      description: "Auth flow scan",
      prompt: "Trace auth validation",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(started.details.status, "running");

  const send = await runTask({
    params: {
      op: "send",
      id: "task_test_0001",
      prompt: "Now include integration tests",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(send.details.op, "send");
  assert.equal(send.details.status, "running");
  assert.match(send.details.summary, /follow-up/i);
  assert.equal(backend.sendCalls.length, 1);
  assert.equal(backend.sendCalls[0]?.followUpPrompts.length, 1);

  backend.resolveSuccess(0, "Finder: Auth flow scan", "done output");
  await Promise.resolve();
  await Promise.resolve();
});

defineTest("runTaskToolMvp send rejects terminal task", async () => {
  const deps = makeDeps();

  const started = await runTask({
    params: {
      op: "start",
      subagent_type: "finder",
      description: "Auth flow scan",
      prompt: "Trace auth validation",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(started.details.status, "succeeded");

  const send = await runTask({
    params: {
      op: "send",
      id: "task_test_0001",
      prompt: "continue",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(send.details.status, "failed");
  assert.equal(send.details.error_code, "task_not_resumable");
});

defineTest("runTaskToolMvp cancel marks running task as cancelled", async () => {
  const backend = new DeferredBackend();
  const deps = makeDeps({ backend });

  const started = await runTask({
    params: {
      op: "start",
      async: true,
      subagent_type: "finder",
      description: "Auth flow scan",
      prompt: "Trace auth validation",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(started.details.status, "running");

  const cancelled = await runTask({
    params: {
      op: "cancel",
      id: "task_test_0001",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(cancelled.details.op, "cancel");
  assert.equal(cancelled.details.status, "cancelled");

  const signal = backend.calls[0]?.input.signal;
  assert.notEqual(signal, undefined);
  assert.equal(signal?.aborted, true);

  const cancelledAgain = await runTask({
    params: {
      op: "cancel",
      id: "task_test_0001",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(cancelledAgain.details.status, "cancelled");
});

defineTest("runTaskToolMvp returns per-id errors on status for unknown IDs", async () => {
  const result = await runTask({
    params: {
      op: "status",
      ids: ["does-not-exist"],
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps: makeDeps(),
  });

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.items?.[0]?.found, false);
  assert.equal(result.details.items?.[0]?.error_code, "unknown_task_id");
});

defineTest("runTaskToolMvp enforces deny policy decisions", async () => {
  const result = await runTask({
    params: {
      op: "start",
      subagent_type: "finder",
      description: "Auth flow scan",
      prompt: "Trace auth",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps: makeDeps({
      loadConfig: async () => ({
        ...loadedConfigFixture,
        config: {
          ...loadedConfigFixture.config,
          subagents: {
            ...runtimeSubagentsFixture,
            permissions: {
              default: "deny",
              subagents: {},
              allowInternalRouting: false,
            },
          },
        },
      }),
    }),
  });

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.error_code, "task_permission_denied");
  assert.equal(result.details.error_category, "policy");
});

defineTest("runTaskToolMvp enforces deny policy on send", async () => {
  const backend = new DeferredBackend();
  let decision: "allow" | "deny" = "allow";

  const deps = makeDeps({
    backend,
    loadConfig: async () => ({
      ...loadedConfigFixture,
      config: {
        ...loadedConfigFixture.config,
        subagents: {
          ...runtimeSubagentsFixture,
          permissions: {
            default: decision,
            subagents: {},
            allowInternalRouting: false,
          },
        },
      },
    }),
  });

  const started = await runTask({
    params: {
      op: "start",
      async: true,
      subagent_type: "finder",
      description: "Auth flow scan",
      prompt: "Trace auth validation",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(started.details.status, "running");

  decision = "deny";
  const send = await runTask({
    params: {
      op: "send",
      id: "task_test_0001",
      prompt: "Now include tests",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(send.details.status, "failed");
  assert.equal(send.details.error_code, "task_permission_denied");
  assert.equal(send.details.error_category, "policy");

  backend.resolveSuccess(0, "Finder: Auth flow scan", "done output");
  await Promise.resolve();
  await Promise.resolve();
});

defineTest("runTaskToolMvp wait reports cancelled terminal state after cancel", async () => {
  const backend = new DeferredBackend();
  const deps = makeDeps({ backend });

  const started = await runTask({
    params: {
      op: "start",
      async: true,
      subagent_type: "finder",
      description: "Auth flow scan",
      prompt: "Trace auth validation",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(started.details.status, "running");

  const cancelled = await runTask({
    params: {
      op: "cancel",
      id: "task_test_0001",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(cancelled.details.status, "cancelled");

  const waited = await runTask({
    params: {
      op: "wait",
      ids: ["task_test_0001"],
      timeout_ms: 100,
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(waited.details.status, "cancelled");
  assert.equal(waited.details.timed_out, false);
  assert.equal(waited.details.items?.[0]?.status, "cancelled");
});

defineTest("runTaskToolMvp maps backend failures to failed task state", async () => {
  const result = await runTask({
    params: {
      op: "start",
      subagent_type: "finder",
      description: "Auth flow scan",
      prompt: "Trace auth",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps: makeDeps({
      backend: new FailingBackend(),
    }),
  });

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.error_code, "backend_failed");
  assert.equal(result.details.task_id, "task_test_0001");
});

defineTest("runTaskToolMvp maps config load failures", async () => {
  const result = await runTask({
    params: {
      op: "start",
      subagent_type: "finder",
      description: "Auth flow scan",
      prompt: "Trace auth",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps: makeDeps({
      loadConfig: async () => {
        throw new Error("disk IO failed");
      },
    }),
  });

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.error_code, "task_config_load_failed");
  assert.equal(result.details.error_category, "runtime");
});

defineTest("runTaskToolMvp supports batch start with deterministic item ordering", async () => {
  const backend = new CountingBackend();
  const deps = makeDeps({ backend });

  const result = await runTask({
    params: {
      op: "start",
      parallel: true,
      tasks: [
        {
          subagent_type: "finder",
          description: "slow-first",
          prompt: "trace slow-first",
        },
        {
          subagent_type: "finder",
          description: "fast-second",
          prompt: "trace fast-second",
        },
        {
          subagent_type: "finder",
          description: "medium-third",
          prompt: "trace medium-third",
        },
      ],
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(result.details.op, "start");
  assert.equal(result.details.status, "succeeded");

  const items = result.details.items ?? [];
  assert.equal(items.length, 3);
  assert.equal(items[0]?.description, "slow-first");
  assert.equal(items[1]?.description, "fast-second");
  assert.equal(items[2]?.description, "medium-third");
  assert.equal(items[0]?.status, "succeeded");
  assert.equal(items[1]?.status, "succeeded");
  assert.equal(items[2]?.status, "succeeded");
});

defineTest("runTaskToolMvp batch start isolates failures", async () => {
  const backend = new CountingBackend();
  const deps = makeDeps({ backend });

  const result = await runTask({
    params: {
      op: "start",
      parallel: true,
      tasks: [
        {
          subagent_type: "finder",
          description: "fast-pass",
          prompt: "trace pass",
        },
        {
          subagent_type: "finder",
          description: "medium-fail",
          prompt: "trace fail",
        },
        {
          subagent_type: "finder",
          description: "slow-pass",
          prompt: "trace pass again",
        },
      ],
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(result.details.status, "failed");
  const items = result.details.items ?? [];
  assert.equal(items.length, 3);
  assert.equal(items[0]?.status, "succeeded");
  assert.equal(items[1]?.status, "failed");
  assert.equal(items[2]?.status, "succeeded");
});

defineTest(
  "runTaskToolMvp batch async honors configured concurrency and wait coverage",
  async () => {
    const backend = new CountingBackend();
    const deps = makeDeps({ backend });

    const started = await runTask({
      params: {
        op: "start",
        async: true,
        parallel: true,
        tasks: [
          {
            subagent_type: "finder",
            description: "slow-1",
            prompt: "trace slow-1",
          },
          {
            subagent_type: "finder",
            description: "slow-2",
            prompt: "trace slow-2",
          },
          {
            subagent_type: "finder",
            description: "slow-3",
            prompt: "trace slow-3",
          },
          {
            subagent_type: "finder",
            description: "slow-4",
            prompt: "trace slow-4",
          },
        ],
      },
      cwd: "/tmp/project",
      signal: undefined,
      onUpdate: undefined,
      deps,
    });

    const ids = (started.details.items ?? []).filter((item) => item.found).map((item) => item.id);

    assert.equal(ids.length, 4);

    const waited = await runTask({
      params: {
        op: "wait",
        ids,
        timeout_ms: 300,
      },
      cwd: "/tmp/project",
      signal: undefined,
      onUpdate: undefined,
      deps,
    });

    assert.equal(waited.details.status, "succeeded");
    assert.equal(
      waited.details.items?.every((item) => item.status === "succeeded"),
      true,
    );
    assert.equal(
      (waited.details.items ?? []).every((item) => Reflect.get(item, "output_available") === true),
      true,
    );
    assert.equal(
      (waited.details.items ?? []).every((item) => typeof Reflect.get(item, "output") === "string"),
      true,
    );
    assert.equal(backend.maxInFlight, 2);
  },
);

defineTest("registerTaskTool registers task tool definition", () => {
  const registeredNames: string[] = [];
  const registeredLabels: string[] = [];
  const registeredDescriptions: string[] = [];

  const extensionApi: Pick<ExtensionAPI, "registerTool"> = {
    registerTool(definition) {
      registeredNames.push(definition.name);
      registeredLabels.push(definition.label);
      registeredDescriptions.push(definition.description);
    },
  };

  registerTaskTool(extensionApi, makeDeps());

  assert.equal(registeredNames.length, 1);
  assert.equal(registeredNames[0], "task");
  assert.equal(registeredLabels[0], "Task");
  assert.match(registeredDescriptions[0], /start\/status\/wait\/send\/cancel/);
  assert.match(registeredDescriptions[0], /Active subagent roster:/);
  assert.match(registeredDescriptions[0], /whenToUse:/);
  assert.match(registeredDescriptions[0], /search/);
});

defineTest("registerTaskTool hides internal profiles from model-visible roster description", () => {
  const registeredDescriptions: string[] = [];

  const internalProfile: OhmSubagentDefinition = {
    id: "oracle",
    name: "Oracle Internal",
    summary: "Internal advisory profile",
    internal: true,
    whenToUse: ["Internal debugging"],
    scaffoldPrompt: "Internal prompt",
  };

  const extensionApi: Pick<ExtensionAPI, "registerTool"> = {
    registerTool(definition) {
      registeredDescriptions.push(definition.description);
    },
  };

  registerTaskTool(
    extensionApi,
    makeDeps({
      subagents: [finderSubagentFixture, internalProfile],
      findSubagentById: (id) => {
        if (id === "finder") return finderSubagentFixture;
        if (id === "oracle") return internalProfile;
        return undefined;
      },
    }),
  );

  const description = registeredDescriptions[0] ?? "";
  assert.match(description, /finder/);
  assert.doesNotMatch(description, /oracle/);
});
