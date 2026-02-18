import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { LoadedOhmRuntimeConfig, OhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import type { OhmSubagentDefinition } from "../catalog";
import { createInMemoryTaskRuntimeStore } from "../runtime/tasks";
import {
  registerPrimarySubagentTools,
  runPrimarySubagentTool,
  type PrimaryToolParameters,
} from "./primary";
import type { TaskToolDependencies } from "./task";
import { runTaskToolMvp } from "./task";

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
  subagents: {
    taskMaxConcurrency: 2,
    taskRetentionMs: 1000 * 60,
    permissions: {
      default: "allow",
      subagents: {},
      allowInternalRouting: false,
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

const librarianFixture: OhmSubagentDefinition = {
  id: "librarian",
  name: "Librarian",
  summary: "Codebase understanding specialist",
  primary: true,
  whenToUse: ["Analyze architecture"],
  scaffoldPrompt: "Analyze repo",
};

const finderFixture: OhmSubagentDefinition = {
  id: "finder",
  name: "Finder",
  summary: "Search specialist",
  whenToUse: ["Find code by behavior"],
  scaffoldPrompt: "Search repo",
};

function makeTaskDeps(overrides: Partial<TaskToolDependencies> = {}): TaskToolDependencies {
  let sequence = 0;

  return {
    loadConfig: async () => loadedConfigFixture,
    backend: {
      id: "primary-test-backend",
      executeStart: async (input) => {
        return Result.ok({
          summary: `${input.subagent.name}: ${input.description}`,
          output: `prompt: ${input.prompt}`,
        });
      },
      executeSend: async (input) => {
        return Result.ok({
          summary: `${input.subagent.name} follow-up: ${input.prompt}`,
          output: `follow-up: ${input.prompt}`,
        });
      },
    },
    findSubagentById: (id) => {
      if (id === "librarian") return librarianFixture;
      if (id === "finder") return finderFixture;
      return undefined;
    },
    subagents: [librarianFixture, finderFixture],
    createTaskId: () => {
      sequence += 1;
      return `task_primary_${String(sequence).padStart(4, "0")}`;
    },
    taskStore: createInMemoryTaskRuntimeStore(),
    ...overrides,
  };
}

defineTest("runPrimarySubagentTool routes through task runtime start semantics", async () => {
  const deps = makeTaskDeps();

  const params: PrimaryToolParameters = {
    prompt: "Map auth architecture",
    description: "Auth architecture scan",
  };

  const result = await runPrimarySubagentTool({
    subagent: librarianFixture,
    params,
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    hasUI: false,
    ui: undefined,
    deps,
  });

  assert.equal(result.details.op, "start");
  assert.equal(result.details.subagent_type, "librarian");
  assert.equal(result.details.description, "Auth architecture scan");
  assert.equal(result.details.backend, "primary-test-backend");
  assert.equal(result.details.status, "succeeded");
});

defineTest("runPrimarySubagentTool defaults description when omitted", async () => {
  const deps = makeTaskDeps();

  const params: PrimaryToolParameters = {
    prompt: "Map auth architecture",
  };

  const result = await runPrimarySubagentTool({
    subagent: librarianFixture,
    params,
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    hasUI: false,
    ui: undefined,
    deps,
  });

  assert.equal(result.details.description, "Librarian direct tool request");
});

defineTest("runPrimarySubagentTool keeps result contract parity with task tool path", async () => {
  const deps = makeTaskDeps();

  const primary = await runPrimarySubagentTool({
    subagent: librarianFixture,
    params: {
      prompt: "Map auth architecture",
      description: "Auth architecture scan",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    hasUI: false,
    ui: undefined,
    deps,
  });

  const task = await runTaskToolMvp({
    params: {
      op: "start",
      subagent_type: "librarian",
      description: "Auth architecture scan",
      prompt: "Map auth architecture",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    hasUI: false,
    ui: undefined,
    deps,
  });

  assert.equal(primary.details.op, task.details.op);
  assert.equal(primary.details.status, task.details.status);
  assert.equal(primary.details.subagent_type, task.details.subagent_type);
  assert.equal(primary.details.description, task.details.description);
  assert.equal(primary.details.backend, task.details.backend);
  assert.equal(primary.details.error_code, task.details.error_code);
});

defineTest("runPrimarySubagentTool fails when subagents feature is disabled", async () => {
  const deps = makeTaskDeps({
    loadConfig: async () => ({
      ...loadedConfigFixture,
      config: {
        ...loadedConfigFixture.config,
        features: {
          ...loadedConfigFixture.config.features,
          subagents: false,
        },
      },
    }),
  });

  const result = await runPrimarySubagentTool({
    subagent: librarianFixture,
    params: {
      prompt: "Map auth architecture",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    hasUI: false,
    ui: undefined,
    deps,
  });

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.error_code, "subagents_disabled");
});

defineTest("registerPrimarySubagentTools registers only primary profiles", () => {
  const registered: string[] = [];
  const descriptions: string[] = [];

  const pi: Pick<ExtensionAPI, "registerTool"> = {
    registerTool(definition) {
      registered.push(definition.name);
      descriptions.push(definition.description);
    },
  };

  const result = registerPrimarySubagentTools(pi, {
    taskDeps: makeTaskDeps(),
    catalog: [librarianFixture, finderFixture],
  });

  assert.deepEqual(registered, ["librarian"]);
  assert.deepEqual(result.registeredTools, ["librarian"]);
  assert.equal(result.diagnostics.length, 0);
  assert.match(descriptions[0] ?? "", /When to use:/);
  assert.match(descriptions[0] ?? "", /Analyze architecture/);
  assert.match(descriptions[0] ?? "", /Task route still available/);
});

defineTest("registerPrimarySubagentTools emits diagnostics for naming collisions", () => {
  const diagnostics: string[] = [];
  const registered: string[] = [];

  const conflictingPrimary: OhmSubagentDefinition = {
    id: "task",
    name: "Task",
    summary: "Conflicting primary",
    primary: true,
    whenToUse: ["conflict"],
    scaffoldPrompt: "conflict",
  };

  const pi: Pick<ExtensionAPI, "registerTool"> = {
    registerTool(definition) {
      registered.push(definition.name);
    },
  };

  const result = registerPrimarySubagentTools(pi, {
    taskDeps: makeTaskDeps(),
    catalog: [conflictingPrimary],
    onDiagnostic: (message) => diagnostics.push(message),
  });

  assert.deepEqual(registered, []);
  assert.equal(result.registeredTools.length, 0);
  assert.equal(result.diagnostics.length, 1);
  assert.match(result.diagnostics[0] ?? "", /naming collision/i);
  assert.equal(diagnostics.length, 1);
});
