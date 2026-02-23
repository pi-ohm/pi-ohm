import assert from "node:assert/strict";
import type { LoadedOhmRuntimeConfig, OhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import type { TaskExecutionBackend } from "../../../runtime/backend/types";
import { createInMemoryTaskRuntimeStore } from "../../../runtime/tasks/store";
import type { TaskToolDependencies } from "../contracts";
import { runTaskToolMvp } from "../operations";
import { defineTest } from "../test-fixtures";

const runtimeConfig: OhmRuntimeConfig = {
  defaultMode: "smart",
  subagentBackend: "interactive-sdk",
  features: {
    handoff: true,
    subagents: true,
    sessionThreadSearch: true,
    handoffVisualizer: true,
    painterImagegen: false,
  },
  painter: {
    googleNanoBanana: { enabled: false, model: "" },
    openai: { enabled: false, model: "" },
    azureOpenai: { enabled: false, deployment: "", endpoint: "", apiVersion: "" },
  },
  subagents: {
    taskMaxConcurrency: 2,
    taskRetentionMs: 60_000,
    permissions: {
      default: "allow",
      subagents: {},
      allowInternalRouting: false,
    },
    profiles: {},
  },
};

const loadedConfig: LoadedOhmRuntimeConfig = {
  config: runtimeConfig,
  paths: {
    configDir: "/tmp/.pi/agent",
    globalConfigFile: "/tmp/.pi/agent/ohm.json",
    projectConfigFile: "/tmp/project/.pi/ohm.json",
    providersConfigFile: "/tmp/.pi/agent/ohm.providers.json",
  },
  loadedFrom: [],
};

function makeDeps(backend: TaskExecutionBackend): TaskToolDependencies {
  return {
    loadConfig: async () => loadedConfig,
    backend,
    findSubagentById: () => ({
      id: "finder",
      name: "Finder",
      summary: "Find code quickly",
      whenToUse: ["Search codebase"],
      scaffoldPrompt: "Search codebase",
      primary: false,
    }),
    subagents: [],
    createTaskId: () => `task_batch_${Date.now()}`,
    taskStore: createInMemoryTaskRuntimeStore(),
  };
}

defineTest("runTaskToolMvp batch start accepts tasks", async () => {
  const backend: TaskExecutionBackend = {
    id: "interactive-sdk",
    async executeStart() {
      return Result.ok({
        summary: "Finder complete",
        output: "done",
        provider: "test",
        model: "test-model",
        runtime: "pi-sdk",
        route: "interactive-sdk",
      });
    },
    async executeSend() {
      return Result.ok({
        summary: "unused",
        output: "unused",
        provider: "test",
        model: "test-model",
        runtime: "pi-sdk",
        route: "interactive-sdk",
      });
    },
  };

  const result = await runTaskToolMvp({
    params: {
      op: "start",
      tasks: [
        {
          subagent_type: "finder",
          description: "batch one",
          prompt: "scan one",
        },
        {
          subagent_type: "finder",
          description: "batch two",
          prompt: "scan two",
        },
      ],
    },
    cwd: "/tmp/project",
    signal: undefined,
    hasUI: false,
    ui: undefined,
    deps: makeDeps(backend),
    onUpdate: undefined,
  });

  assert.equal(result.details.op, "start");
  assert.equal(result.details.status, "succeeded");
  assert.equal((result.details.items ?? []).length, 2);
});
