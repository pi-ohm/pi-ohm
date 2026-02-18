import assert from "node:assert/strict";
import test from "node:test";
import type { OhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import type { OhmSubagentDefinition } from "../catalog";
import { ScaffoldTaskExecutionBackend } from "./backend";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

const configFixture: OhmRuntimeConfig = {
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
    config: configFixture,
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
    config: configFixture,
    signal: controller.signal,
  });

  assert.equal(Result.isError(result), true);
  if (Result.isOk(result)) {
    assert.fail("Expected aborted signal to produce runtime error");
  }

  assert.equal(result.error.code, "task_aborted");
  assert.equal(result.error.stage, "execute_start");
});
