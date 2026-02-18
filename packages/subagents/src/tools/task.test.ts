import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { LoadedOhmRuntimeConfig, OhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import type { OhmSubagentDefinition } from "../catalog";
import { SubagentRuntimeError } from "../errors";
import type { TaskBackendStartInput, TaskExecutionBackend } from "../runtime/backend";
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

function makeDeps(overrides: Partial<TaskToolDependencies> = {}): TaskToolDependencies {
  return {
    loadConfig: async () => loadedConfigFixture,
    backend: new SuccessfulBackend(),
    findSubagentById: (id) => (id === "finder" ? finderSubagentFixture : undefined),
    createTaskId: () => "task_test_0001",
    taskStore: createInMemoryTaskRuntimeStore(),
    ...overrides,
  };
}

defineTest("createTaskId creates deterministic prefixed IDs", () => {
  const taskId = createTaskId(1700000000000);
  assert.match(taskId, /^task_1700000000000_\d{4}$/);
});

defineTest("formatTaskToolCall supports start/status/wait/cancel", () => {
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

defineTest("runTaskToolMvp returns validation failure for malformed payload", async () => {
  const result = await runTaskToolMvp({
    params: { op: "start", prompt: "missing fields" },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps: makeDeps(),
  });

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.error_code, "invalid_task_tool_payload");
});

defineTest("runTaskToolMvp handles sync start success", async () => {
  const updates: string[] = [];

  const result = await runTaskToolMvp({
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

  assert.deepEqual(updates, ["running"]);
  assert.equal(result.details.status, "succeeded");
  assert.equal(result.details.task_id, "task_test_0001");
  assert.equal(result.details.subagent_type, "finder");
  assert.equal(result.details.backend, "test-backend");
  assert.match(result.details.summary, /Finder/);
});

defineTest("runTaskToolMvp handles async start and status lifecycle", async () => {
  const backend = new DeferredBackend();
  const deps = makeDeps({ backend });

  const started = await runTaskToolMvp({
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

  const statusBefore = await runTaskToolMvp({
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

  const statusAfter = await runTaskToolMvp({
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

  const started = await runTaskToolMvp({
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

  const waited = await runTaskToolMvp({
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

  backend.resolveSuccess(0, "Finder: Auth flow scan", "done output");
  await Promise.resolve();
  await Promise.resolve();

  const waitedAfter = await runTaskToolMvp({
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

defineTest("runTaskToolMvp cancel marks running task as cancelled", async () => {
  const backend = new DeferredBackend();
  const deps = makeDeps({ backend });

  const started = await runTaskToolMvp({
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

  const cancelled = await runTaskToolMvp({
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

  const cancelledAgain = await runTaskToolMvp({
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
  const result = await runTaskToolMvp({
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

defineTest("runTaskToolMvp maps backend failures to failed task state", async () => {
  const result = await runTaskToolMvp({
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
  const result = await runTaskToolMvp({
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
});

defineTest("runTaskToolMvp still reports unsupported send operation", async () => {
  const result = await runTaskToolMvp({
    params: {
      op: "send",
      id: "task_test_0001",
      prompt: "continue",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps: makeDeps(),
  });

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.error_code, "task_operation_not_supported");
});

defineTest("runTaskToolMvp rejects batch start for now", async () => {
  const result = await runTaskToolMvp({
    params: {
      op: "start",
      tasks: [
        {
          subagent_type: "finder",
          description: "scan",
          prompt: "trace",
        },
      ],
      parallel: true,
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps: makeDeps(),
  });

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.error_code, "task_batch_not_supported");
});

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
  assert.match(registeredDescriptions[0], /start\/status\/wait\/cancel/);
});
