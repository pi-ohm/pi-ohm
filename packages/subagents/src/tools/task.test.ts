import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { LoadedOhmRuntimeConfig, OhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import type { OhmSubagentDefinition } from "../catalog";
import { SubagentRuntimeError } from "../errors";
import type { TaskExecutionBackend } from "../runtime/backend";
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

function makeDeps(overrides: Partial<TaskToolDependencies> = {}): TaskToolDependencies {
  return {
    loadConfig: async () => loadedConfigFixture,
    backend: new SuccessfulBackend(),
    findSubagentById: (id) => (id === "finder" ? finderSubagentFixture : undefined),
    createTaskId: () => "task_test_0001",
    ...overrides,
  };
}

defineTest("createTaskId creates deterministic prefixed IDs", () => {
  const taskId = createTaskId(1700000000000);
  assert.match(taskId, /^task_1700000000000_\d{4}$/);
});

defineTest("formatTaskToolCall supports single start, batch start, and other ops", () => {
  assert.equal(
    formatTaskToolCall({
      op: "start",
      subagent_type: "finder",
      description: "Auth flow scan",
      prompt: "Trace auth",
    }),
    "task start finder · Auth flow scan",
  );

  assert.equal(
    formatTaskToolCall({
      op: "start",
      tasks: [
        {
          subagent_type: "finder",
          description: "scan",
          prompt: "trace",
        },
      ],
      parallel: true,
    }),
    "task start batch (1)",
  );

  assert.equal(
    formatTaskToolCall({
      op: "status",
      ids: ["task_1"],
    }),
    "task status",
  );
});

defineTest("formatTaskToolResult includes details and expanded output", () => {
  const details = {
    op: "start",
    status: "succeeded",
    task_id: "task_1",
    subagent_type: "finder",
    description: "Auth flow scan",
    summary: "Finder: Auth flow scan",
    backend: "test-backend",
    invocation: "task-routed",
    output: "Long output",
  } as const;

  const compact = formatTaskToolResult(details, false);
  const expanded = formatTaskToolResult(details, true);

  assert.match(compact, /Finder: Auth flow scan/);
  assert.doesNotMatch(compact, /Long output/);
  assert.match(expanded, /Long output/);
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

defineTest("runTaskToolMvp rejects unsupported non-start operations in MVP", async () => {
  const result = await runTaskToolMvp({
    params: { op: "status", ids: ["task_1"] },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps: makeDeps(),
  });

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.error_code, "task_operation_not_supported");
});

defineTest("runTaskToolMvp rejects batch start in MVP", async () => {
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

defineTest("runTaskToolMvp rejects unknown subagent types", async () => {
  const result = await runTaskToolMvp({
    params: {
      op: "start",
      subagent_type: "does-not-exist",
      description: "scan",
      prompt: "trace",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps: makeDeps(),
  });

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.error_code, "unknown_subagent_type");
});

defineTest("runTaskToolMvp enforces subagent availability checks", async () => {
  const painterProfile: OhmSubagentDefinition = {
    id: "painter",
    name: "Painter",
    summary: "Image generation",
    whenToUse: ["images"],
    scaffoldPrompt: "paint",
    requiresPackage: "@pi-ohm/painter",
  };

  const result = await runTaskToolMvp({
    params: {
      op: "start",
      subagent_type: "painter",
      description: "Generate mock image",
      prompt: "Create mockups",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    deps: makeDeps({
      findSubagentById: (id) => (id === "painter" ? painterProfile : undefined),
    }),
  });

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.error_code, "subagent_unavailable");
});

defineTest("runTaskToolMvp emits running update and returns succeeded result", async () => {
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

defineTest("runTaskToolMvp maps backend failures to deterministic error payload", async () => {
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
  assert.match(registeredDescriptions[0], /MVP supports op:start/);
});
