import assert from "node:assert/strict";
import test from "node:test";
import { Theme, type AgentToolResult, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { LoadedOhmRuntimeConfig, OhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import type { OhmSubagentDefinition } from "../../catalog";
import { createInMemoryTaskRuntimeStore } from "../../runtime/tasks/store";
import {
  PrimaryToolParametersSchemasBySubagent,
  registerPrimarySubagentTools,
  runPrimarySubagentTool,
} from "../primary";
import type { TaskToolDependencies, TaskToolResultDetails } from "../task/contracts";
import { runTaskToolMvp } from "../task/operations";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

function stripAnsi(value: string): string {
  return value
    .split("\u001b[1m")
    .join("")
    .split("\u001b[22m")
    .join("")
    .split("\u001b[4m")
    .join("")
    .split("\u001b[24m")
    .join("")
    .split("\u001b[31m")
    .join("")
    .split("\u001b[32m")
    .join("")
    .split("\u001b[37m")
    .join("")
    .split("\u001b[39m")
    .join("")
    .split("\u001b[0m")
    .join("");
}

interface RenderablePrimaryToolDefinition {
  readonly renderResult: (
    result: AgentToolResult<TaskToolResultDetails>,
    options: { readonly expanded: boolean; readonly isPartial: boolean },
    theme: Theme,
  ) => { render(width: number): string[] };
}

function isRenderablePrimaryToolDefinition(
  value: unknown,
): value is RenderablePrimaryToolDefinition {
  if (typeof value !== "object" || value === null) return false;
  const renderResult = Reflect.get(value, "renderResult");
  return typeof renderResult === "function";
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
    profiles: {},
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
  description: "Codebase understanding specialist",
  primary: true,
  whenToUse: ["Analyze architecture"],
  whenNotToUse: ["Simple exact-path file reads"],
  usageGuidelines: ["Provide repository scope and success criteria"],
  examples: ["Map auth architecture across service and client repos"],
};

const finderFixture: OhmSubagentDefinition = {
  id: "finder",
  name: "Finder",
  description: "Search specialist",
  whenToUse: ["Find code by behavior"],
};

const oracleFixture: OhmSubagentDefinition = {
  id: "oracle",
  name: "Oracle",
  description: "Architecture and code review advisor",
  primary: true,
  whenToUse: ["Review architecture"],
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
      if (id === "oracle") return oracleFixture;
      return undefined;
    },
    subagents: [librarianFixture, finderFixture, oracleFixture],
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

  const params = {
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

  const params = {
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

defineTest("runPrimarySubagentTool librarian accepts query + context payload", async () => {
  const deps = makeTaskDeps();

  const result = await runPrimarySubagentTool({
    subagent: librarianFixture,
    params: {
      query: "Explain auth architecture",
      context: "Focus on monorepo boundaries and service edges",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    hasUI: false,
    ui: undefined,
    deps,
  });

  assert.equal(result.details.status, "succeeded");
  assert.match(result.details.output ?? "", /Explain auth architecture/);
  assert.match(result.details.output ?? "", /Context:/);
  assert.match(result.details.output ?? "", /monorepo boundaries/);
});

defineTest("runPrimarySubagentTool oracle accepts task + context + files payload", async () => {
  const deps = makeTaskDeps();

  const result = await runPrimarySubagentTool({
    subagent: oracleFixture,
    params: {
      task: "Review auth refactor plan",
      context: "Need risk-ranked rollout guidance",
      files: ["packages/subagents/src/tools/task.ts", "packages/subagents/src/runtime/tasks.ts"],
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    hasUI: false,
    ui: undefined,
    deps,
  });

  assert.equal(result.details.status, "succeeded");
  assert.match(result.details.output ?? "", /Review auth refactor plan/);
  assert.match(result.details.output ?? "", /Context:/);
  assert.match(result.details.output ?? "", /Files:/);
  assert.match(result.details.output ?? "", /packages\/subagents\/src\/tools\/task.ts/);
  assert.match(result.details.output ?? "", /Inspect these paths first\./);
});

defineTest("runPrimarySubagentTool finder accepts query payload", async () => {
  const deps = makeTaskDeps();

  const result = await runPrimarySubagentTool({
    subagent: finderFixture,
    params: {
      query: "Find JWT verification entry points",
    },
    cwd: "/tmp/project",
    signal: undefined,
    onUpdate: undefined,
    hasUI: false,
    ui: undefined,
    deps,
  });

  assert.equal(result.details.status, "succeeded");
  assert.match(result.details.output ?? "", /Find JWT verification entry points/);
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
  assert.equal(primary.details.contract_version, task.details.contract_version);
  assert.equal(primary.details.output_available, task.details.output_available);
  assert.equal(primary.details.output, task.details.output);
  assert.equal(primary.details.route, task.details.route);
  assert.equal(primary.details.runtime, task.details.runtime);
  assert.equal(primary.details.provider, task.details.provider);
  assert.equal(primary.details.model, task.details.model);
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
  assert.match(descriptions[0] ?? "", /When not to use:/);
  assert.match(descriptions[0] ?? "", /Usage guidelines:/);
  assert.match(descriptions[0] ?? "", /Examples:/);
  assert.match(descriptions[0] ?? "", /Task route still available/);
});

defineTest("registerPrimarySubagentTools exposes specialized schema per subagent", () => {
  const definitionsByName = new Map<string, unknown>();

  const pi: Pick<ExtensionAPI, "registerTool"> = {
    registerTool(definition) {
      definitionsByName.set(definition.name, definition.parameters);
    },
  };

  registerPrimarySubagentTools(pi, {
    taskDeps: makeTaskDeps(),
    catalog: [librarianFixture, { ...finderFixture, primary: true }, oracleFixture],
  });

  const librarianSchema = JSON.stringify(definitionsByName.get("librarian") ?? {});
  const finderSchema = JSON.stringify(definitionsByName.get("finder") ?? {});
  const oracleSchema = JSON.stringify(definitionsByName.get("oracle") ?? {});

  assert.match(librarianSchema, /"query"/);
  assert.match(librarianSchema, /"context"/);

  assert.match(finderSchema, /"query"/);
  assert.doesNotMatch(finderSchema, /"files"/);

  assert.match(oracleSchema, /"task"/);
  assert.match(oracleSchema, /"context"/);
  assert.match(oracleSchema, /"files"/);

  assert.match(JSON.stringify(PrimaryToolParametersSchemasBySubagent.oracle), /"task"/);
});

defineTest("registerPrimarySubagentTools emits diagnostics for naming collisions", () => {
  const diagnostics: string[] = [];
  const registered: string[] = [];

  const conflictingPrimary: OhmSubagentDefinition = {
    id: "task",
    name: "Task",
    description: "Conflicting primary",
    primary: true,
    whenToUse: ["conflict"],
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

defineTest("registerPrimarySubagentTools renderResult respects expanded toggle", () => {
  let librarianToolDefinition: unknown;
  const renderTheme = new Theme(
    new Proxy<Record<string, number>>(
      {},
      {
        get: () => 7,
      },
    ),
    new Proxy<Record<string, number>>(
      {},
      {
        get: () => 0,
      },
    ),
    "truecolor",
  );

  const pi: Pick<ExtensionAPI, "registerTool"> = {
    registerTool(definition) {
      if (definition.name === "librarian") {
        librarianToolDefinition = definition;
      }
    },
  };

  registerPrimarySubagentTools(pi, {
    taskDeps: makeTaskDeps(),
    catalog: [librarianFixture],
  });

  if (!isRenderablePrimaryToolDefinition(librarianToolDefinition)) {
    assert.fail("expected librarian primary tool renderResult to be registered");
  }

  const details: TaskToolResultDetails = {
    op: "start",
    status: "succeeded",
    backend: "task",
    summary: "done",
    subagent_type: "librarian",
    description: "search codebase",
    prompt: "search codebase",
    tool_rows: ["✓ Read a", "✓ Grep b", "✓ Find c", "✓ Ls d"],
    assistant_text: "done",
    output_available: false,
  };

  const result: AgentToolResult<TaskToolResultDetails> = {
    content: [{ type: "text", text: "done" }],
    details,
  };

  const collapsed = librarianToolDefinition.renderResult(
    result,
    { expanded: false, isPartial: false },
    renderTheme,
  );
  const collapsedText = stripAnsi(collapsed.render(160).join("\n"));
  assert.equal(collapsedText.includes("Find c"), false);
  assert.equal(collapsedText.includes("ctrl+o to expand"), true);

  const expanded = librarianToolDefinition.renderResult(
    result,
    { expanded: true, isPartial: false },
    renderTheme,
  );
  const expandedText = stripAnsi(expanded.render(160).join("\n"));
  assert.equal(expandedText.includes("Find c"), true);
  assert.equal(expandedText.includes("ctrl+o to expand"), false);
});
