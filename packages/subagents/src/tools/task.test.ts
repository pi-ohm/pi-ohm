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
  createCollapsedTaskToolResultComponent,
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

function isRenderableWidget(value: unknown): value is { render(width: number): string[] } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const render = Reflect.get(value, "render");
  return typeof render === "function";
}

function renderWidgetLines(content: unknown): readonly string[] | undefined {
  if (typeof content !== "function") {
    return undefined;
  }

  const component = content();
  if (!isRenderableWidget(component)) {
    return undefined;
  }

  return component.render(120);
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

  assert.doesNotMatch(compact, /items:/);
  assert.match(compact, /⠋ Finder · Auth flow scan/);
  assert.match(compact, /✕ Task task_missing/);
  assert.match(compact, /Unknown task id/);
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

  assert.match(compact, /✓ Finder · Auth flow scan/);
  assert.match(compact, /├── Auth flow scan/);
  assert.doesNotMatch(compact, /line one/);
  assert.match(compact, /╰── line three/);
});

defineTest("formatTaskToolResult expanded view keeps multiline body", () => {
  const expanded = formatTaskToolResult(
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
    true,
  );

  assert.match(expanded, /line one/);
  assert.match(expanded, /line two/);
  assert.match(expanded, /line three/);
});

defineTest("formatTaskToolResult preserves per-item output in compact collection rendering", () => {
  const compact = formatTaskToolResult(
    {
      op: "status",
      status: "succeeded",
      summary: "status for 1 task(s)",
      backend: "test-backend",
      items: [
        {
          id: "task_1",
          found: true,
          status: "succeeded",
          subagent_type: "finder",
          description: "Chat transcript",
          summary: "Finder completed",
          output_available: true,
          output: "tool_call: read\nassistant: done",
        },
      ],
    },
    false,
  );

  assert.match(compact, /✓ Finder · Chat transcript/);
  assert.match(compact, /✓ tool_call: read/);
  assert.match(compact, /╰── done/);
});

defineTest("formatTaskToolResult prefers structured tool_rows over output scraping", () => {
  const compact = formatTaskToolResult(
    {
      op: "start",
      status: "succeeded",
      task_id: "task_1",
      subagent_type: "finder",
      description: "Structured rows",
      summary: "Finder: Structured rows",
      output: "final summary only",
      output_available: true,
      backend: "test-backend",
      tool_rows: ['○ read {"path":"src/index.ts"}', '✓ read {"ok":true}'],
    },
    false,
  );

  assert.match(compact, /○ read/);
  assert.match(compact, /✓ read/);
});

defineTest("formatTaskToolResult uses minimal inline style for running background tasks", () => {
  const compact = formatTaskToolResult(
    {
      op: "start",
      status: "running",
      task_id: "task_1",
      subagent_type: "finder",
      description: "Background indexing",
      summary: "Started async Finder: Background indexing",
      backend: "test-backend",
    },
    false,
  );

  assert.match(compact, /^⠋ Finder · Background indexing · background/m);
  assert.match(compact, /task_id: task_1/);
  assert.doesNotMatch(compact, /├──/);
  assert.doesNotMatch(compact, /╰──/);
});

defineTest("formatTaskToolResult hides backend metadata when OHM_DEBUG is disabled", () => {
  const previous = process.env.OHM_DEBUG;
  delete process.env.OHM_DEBUG;

  try {
    const compact = formatTaskToolResult(
      {
        op: "wait",
        status: "succeeded",
        summary: "wait for 1 task(s)",
        backend: "interactive-shell",
        provider: "unavailable",
        model: "unavailable",
        runtime: "pi-cli",
        route: "interactive-shell",
      },
      false,
    );

    assert.doesNotMatch(compact, /backend:/);
    assert.doesNotMatch(compact, /provider:/);
    assert.doesNotMatch(compact, /runtime:/);
    assert.match(compact, /✓ wait for 1 task\(s\)/);
  } finally {
    if (previous === undefined) {
      delete process.env.OHM_DEBUG;
    } else {
      process.env.OHM_DEBUG = previous;
    }
  }
});

defineTest("formatTaskToolResult shows verbose metadata when OHM_DEBUG=true", () => {
  const previous = process.env.OHM_DEBUG;
  process.env.OHM_DEBUG = "true";

  try {
    const verbose = formatTaskToolResult(
      {
        op: "wait",
        status: "succeeded",
        summary: "wait for 1 task(s)",
        backend: "interactive-shell",
        provider: "unavailable",
        model: "unavailable",
        runtime: "pi-cli",
        route: "interactive-shell",
      },
      false,
    );

    assert.match(verbose, /backend: interactive-shell/);
    assert.match(verbose, /provider: unavailable/);
    assert.match(verbose, /runtime: pi-cli/);
  } finally {
    if (previous === undefined) {
      delete process.env.OHM_DEBUG;
    } else {
      process.env.OHM_DEBUG = previous;
    }
  }
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
  assert.equal(Reflect.get(result.details, "contract_version"), "task.v1");
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
  assert.equal(waited.details.items?.[0]?.error_category, "not_found");
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
  assert.equal(Reflect.get(result.details, "contract_version"), "task.v1");
  assert.equal(result.details.task_id, "task_test_0001");
  assert.equal(result.details.subagent_type, "finder");
  assert.equal(result.details.backend, "test-backend");
  assert.match(result.details.summary, /Finder/);
});

defineTest(
  "runTaskToolMvp streams inline updates in UI mode without legacy runtime text",
  async () => {
    const updates: string[] = [];
    const updateStatuses: string[] = [];
    const statuses: string[] = [];

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
        updateStatuses.push(partial.details.status);
        const text = partial.content.find((part) => part.type === "text");
        if (text && text.type === "text") {
          updates.push(text.text);
        }
      },
      hasUI: true,
      ui: {
        setStatus: (_key, text) => {
          if (typeof text === "string") {
            statuses.push(text);
          }
        },
        setWidget: () => {},
      },
      deps: makeDeps(),
    });

    assert.equal(result.details.status, "succeeded");
    assert.equal(statuses.length, 0);
    assert.deepEqual(updateStatuses, ["running", "succeeded"]);
    assert.equal(updates.length >= 2, true);
    for (const update of updates) {
      assert.equal(update.includes("[finder]"), false);
    }
    assert.match(updates.at(-1) ?? "", /✓ Finder/);
  },
);

defineTest("runTaskToolMvp keeps widget surface empty by default", async () => {
  const widgetFrames: (readonly string[] | undefined)[] = [];

  const result = await runTaskToolMvp({
    params: {
      op: "start",
      subagent_type: "finder",
      description: "Auth flow scan",
      prompt: "Trace auth validation",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    hasUI: true,
    ui: {
      setStatus: () => {},
      setWidget: (_key, content) => {
        widgetFrames.push(renderWidgetLines(content));
      },
    },
    deps: makeDeps(),
  });

  await sleep(220);

  assert.equal(result.details.status, "succeeded");
  assert.equal(
    widgetFrames.every((frame) => frame === undefined),
    true,
  );
});

defineTest("runTaskToolMvp does not animate live widget frames when mode is off", async () => {
  const backend = new DeferredBackend();
  const deps = makeDeps({ backend });
  const widgetFrames: string[] = [];

  const started = await runTaskToolMvp({
    params: {
      op: "start",
      async: true,
      subagent_type: "finder",
      description: "Animated frame check",
      prompt: "Keep running briefly",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    hasUI: true,
    ui: {
      setStatus: () => {},
      setWidget: (_key, content) => {
        const lines = renderWidgetLines(content);
        if (Array.isArray(lines) && lines.length > 0) {
          widgetFrames.push(lines[0] ?? "");
        }
      },
    },
    deps,
  });

  assert.equal(started.details.status, "running");

  await sleep(360);

  assert.equal(widgetFrames.length, 0);

  backend.resolveSuccess(0, "Finder: Animated frame check", "done");
  await sleep(80);
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

  assert.match(textBlock.text, /✓ Finder · Multiline/);
  assert.match(textBlock.text, /├── Return multiple lines/);
  assert.doesNotMatch(textBlock.text, /alpha/);
  assert.match(textBlock.text, /gamma/);
});

defineTest("runTaskToolMvp exposes truncation metadata for long output", async () => {
  const previous = process.env.OHM_SUBAGENTS_OUTPUT_MAX_CHARS;
  process.env.OHM_SUBAGENTS_OUTPUT_MAX_CHARS = "24";

  try {
    const deps = makeDeps({
      backend: {
        id: "truncate-backend",
        async executeStart() {
          return Result.ok({
            summary: "Finder: long output",
            output: "abcdefghijklmnopqrstuvwxyz0123456789",
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
        description: "Long output",
        prompt: "Return long output",
      },
      cwd: "/tmp/project",
      signal: undefined,
      onUpdate: undefined,
      deps,
    });

    assert.equal(Reflect.get(result.details, "output_truncated"), true);
    assert.equal(Reflect.get(result.details, "output_total_chars"), 36);
    assert.equal(Reflect.get(result.details, "output_returned_chars"), 24);

    const textBlock = result.content.find((part) => part.type === "text");
    assert.notEqual(textBlock, undefined);
    if (!textBlock || textBlock.type !== "text") {
      assert.fail("Expected text content block");
    }

    assert.match(textBlock.text, /truncated 24\/36 chars/);
  } finally {
    if (previous === undefined) {
      delete process.env.OHM_SUBAGENTS_OUTPUT_MAX_CHARS;
    } else {
      process.env.OHM_SUBAGENTS_OUTPUT_MAX_CHARS = previous;
    }
  }
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
  assert.equal(Reflect.get(statusBefore.details, "contract_version"), "task.v1");
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
  assert.equal(Reflect.get(waited.details, "done"), false);
  assert.equal(Reflect.get(waited.details, "wait_status"), "timeout");
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
  assert.equal(Reflect.get(waitedAfter.details, "done"), true);
  assert.equal(Reflect.get(waitedAfter.details, "wait_status"), "completed");
});

defineTest("runTaskToolMvp wait streams live inline updates in UI mode", async () => {
  const backend = new DeferredBackend();
  const deps = makeDeps({ backend });

  const started = await runTask({
    params: {
      op: "start",
      async: true,
      subagent_type: "finder",
      description: "Wait stream",
      prompt: "Trace auth validation",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(started.details.status, "running");

  setTimeout(() => {
    backend.resolveSuccess(0, "Finder: Wait stream", "done output");
  }, 220);

  const updateStatuses: string[] = [];
  const updates: string[] = [];

  const waited = await runTaskToolMvp({
    params: {
      op: "wait",
      ids: ["task_test_0001"],
      timeout_ms: 1000,
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: (partial) => {
      updateStatuses.push(partial.details.status);
      const text = partial.content.find((part) => part.type === "text");
      if (text?.type === "text") {
        updates.push(text.text);
      }
    },
    hasUI: true,
    ui: {
      setStatus: () => {},
      setWidget: () => {},
    },
    deps,
  });

  assert.equal(waited.details.status, "succeeded");
  assert.equal(updateStatuses.includes("running"), true);
  assert.equal(updateStatuses.at(-1), "succeeded");
  assert.equal(updates.length >= 2, true);
  assert.match(updates.at(-1) ?? "", /✓ Finder · Wait stream/);
});

defineTest("runTaskToolMvp wait exposes aborted outcome contract", async () => {
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

  const controller = new AbortController();
  controller.abort();

  const waited = await runTask({
    params: {
      op: "wait",
      ids: ["task_test_0001"],
      timeout_ms: 100,
    },
    cwd: "/tmp/project",
    signal: controller.signal,
    onUpdate: undefined,
    deps,
  });

  assert.equal(waited.details.status, "running");
  assert.equal(waited.details.error_code, "task_wait_aborted");
  assert.equal(waited.details.timed_out, true);
  assert.equal(Reflect.get(waited.details, "done"), false);
  assert.equal(Reflect.get(waited.details, "wait_status"), "aborted");

  backend.resolveSuccess(0, "Finder: Auth flow scan", "done output");
  await Promise.resolve();
  await Promise.resolve();
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
  assert.equal(Reflect.get(cancelled.details, "cancel_applied"), true);
  assert.equal(Reflect.get(cancelled.details, "prior_status"), "running");

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
  assert.equal(Reflect.get(cancelledAgain.details, "cancel_applied"), false);
  assert.equal(Reflect.get(cancelledAgain.details, "prior_status"), "cancelled");
});

defineTest("runTaskToolMvp cancel on completed task is explicit no-op", async () => {
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

  assert.equal(cancelled.details.status, "succeeded");
  assert.equal(Reflect.get(cancelled.details, "cancel_applied"), false);
  assert.equal(Reflect.get(cancelled.details, "prior_status"), "succeeded");
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
  assert.equal(result.details.items?.[0]?.error_category, "not_found");
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
  assert.equal(Reflect.get(result.details, "accepted_count"), 3);
  assert.equal(Reflect.get(result.details, "rejected_count"), 0);
  assert.equal(Reflect.get(result.details, "batch_status"), "completed");

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
  assert.equal(Reflect.get(result.details, "accepted_count"), 3);
  assert.equal(Reflect.get(result.details, "rejected_count"), 0);
  assert.equal(Reflect.get(result.details, "batch_status"), "partial");
  const items = result.details.items ?? [];
  assert.equal(items.length, 3);
  assert.equal(items[0]?.status, "succeeded");
  assert.equal(items[1]?.status, "failed");
  assert.equal(items[2]?.status, "succeeded");
});

defineTest("runTaskToolMvp batch async mixed validity reports partial acceptance", async () => {
  const backend = new DeferredBackend();
  const deps = makeDeps({ backend });

  const started = await runTask({
    params: {
      op: "start",
      async: true,
      parallel: true,
      tasks: [
        {
          subagent_type: "finder",
          description: "valid-1",
          prompt: "trace valid-1",
        },
        {
          subagent_type: "unknown-subagent",
          description: "invalid-2",
          prompt: "trace invalid-2",
        },
        {
          subagent_type: "finder",
          description: "valid-3",
          prompt: "trace valid-3",
        },
      ],
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(started.details.status, "running");
  assert.equal(Reflect.get(started.details, "accepted_count"), 2);
  assert.equal(Reflect.get(started.details, "rejected_count"), 1);
  assert.equal(Reflect.get(started.details, "batch_status"), "partial");

  const acceptedIds = (started.details.items ?? [])
    .filter((item) => item.found)
    .map((item) => item.id);

  assert.equal(acceptedIds.length, 2);

  backend.resolveSuccess(0, "Finder: valid-1", "output valid-1");
  backend.resolveSuccess(1, "Finder: valid-3", "output valid-3");
  await Promise.resolve();
  await Promise.resolve();

  const waited = await runTask({
    params: {
      op: "wait",
      ids: acceptedIds,
      timeout_ms: 200,
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(waited.details.status, "succeeded");
  assert.equal(Reflect.get(waited.details, "done"), true);
  assert.equal(Reflect.get(waited.details, "wait_status"), "completed");
});

defineTest("runTaskToolMvp exposes observability fields in lifecycle payload", async () => {
  const deps = makeDeps();

  const started = await runTask({
    params: {
      op: "start",
      subagent_type: "finder",
      description: "Observability scan",
      prompt: "Trace runtime route",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(Reflect.get(started.details, "runtime"), "test-backend");
  assert.equal(Reflect.get(started.details, "route"), "test-backend");
  assert.equal(Reflect.get(started.details, "provider"), "unavailable");
  assert.equal(Reflect.get(started.details, "model"), "unavailable");
});

defineTest("runTaskToolMvp exposes tool_rows from structured backend events", async () => {
  const deps = makeDeps({
    backend: {
      id: "interactive-sdk",
      async executeStart() {
        return Result.ok({
          summary: "Finder: eventful",
          output: "eventful output",
          provider: "unavailable",
          model: "unavailable",
          runtime: "pi-sdk",
          route: "interactive-sdk",
          events: [
            {
              type: "tool_start",
              toolCallId: "tool_1",
              toolName: "read",
              argsText: '{"path":"src/index.ts"}',
              atEpochMs: 1001,
            },
            {
              type: "tool_end",
              toolCallId: "tool_1",
              toolName: "read",
              resultText: '{"ok":true}',
              status: "success",
              atEpochMs: 1002,
            },
          ],
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

  const started = await runTask({
    params: {
      op: "start",
      subagent_type: "finder",
      description: "Structured rows",
      prompt: "Return structured rows",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(started.details.status, "succeeded");
  assert.deepEqual(Reflect.get(started.details, "tool_rows"), [
    '○ read {"path":"src/index.ts"}',
    '✓ read {"ok":true}',
  ]);
  assert.equal(Reflect.get(started.details, "event_count"), 2);
});

defineTest("runTaskToolMvp uses assistant_text from events for terminal result row", async () => {
  const deps = makeDeps({
    backend: {
      id: "interactive-sdk",
      async executeStart() {
        return Result.ok({
          summary: "Finder: assistant text",
          output: "",
          provider: "unavailable",
          model: "unavailable",
          runtime: "pi-sdk",
          route: "interactive-sdk",
          events: [
            {
              type: "assistant_text_delta",
              delta: "structured final answer",
              atEpochMs: 1001,
            },
          ],
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

  const started = await runTask({
    params: {
      op: "start",
      subagent_type: "finder",
      description: "Assistant text fallback",
      prompt: "Prefer assistant text",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(Reflect.get(started.details, "assistant_text"), "structured final answer");
  const textBlock = started.content.find((part) => part.type === "text");
  assert.notEqual(textBlock, undefined);
  if (textBlock?.type !== "text") {
    assert.fail("Expected text block");
  }

  assert.match(textBlock.text, /structured final answer/);
});

defineTest("runTaskToolMvp status aggregates runtime observability from task items", async () => {
  const deps = makeDeps({
    backend: {
      id: "interactive-shell",
      async executeStart() {
        return Result.ok({
          summary: "Finder: runtime test",
          output: "runtime test output",
          provider: "unavailable",
          model: "unavailable",
          runtime: "pi-cli",
          route: "interactive-shell",
        });
      },
      async executeSend() {
        return Result.ok({
          summary: "Finder follow-up",
          output: "follow-up",
          provider: "unavailable",
          model: "unavailable",
          runtime: "pi-cli",
          route: "interactive-shell",
        });
      },
    },
  });

  const started = await runTask({
    params: {
      op: "start",
      subagent_type: "finder",
      description: "Runtime alignment check",
      prompt: "Return runtime metadata",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(Reflect.get(started.details, "runtime"), "pi-cli");
  assert.equal(Reflect.get(started.details, "route"), "interactive-shell");

  const status = await runTask({
    params: {
      op: "status",
      ids: [String(started.details.task_id ?? "")],
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps,
  });

  assert.equal(Reflect.get(status.details, "runtime"), "pi-cli");
  assert.equal(Reflect.get(status.details, "route"), "interactive-shell");
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
  assert.match(registeredDescriptions[0], /Default behavior is sync/);
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

defineTest("createCollapsedTaskToolResultComponent shows ctrl+o hint for long output", () => {
  const text = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n");
  const component = createCollapsedTaskToolResultComponent(text, 5);

  const rendered = component.render(80);
  assert.equal(rendered.length, 6);
  assert.match(rendered[0] ?? "", /ctrl\+o to expand/);
  assert.match(rendered.at(-1) ?? "", /line 30/);
});

defineTest(
  "createCollapsedTaskToolResultComponent returns full lines when within preview budget",
  () => {
    const text = ["line 1", "line 2", "line 3"].join("\n");
    const component = createCollapsedTaskToolResultComponent(text, 5);

    const rendered = component.render(80);
    assert.deepEqual(
      rendered.map((line) => line.trimEnd()),
      ["line 1", "line 2", "line 3"],
    );
  },
);
