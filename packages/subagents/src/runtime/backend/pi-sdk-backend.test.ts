import assert from "node:assert/strict";
import test from "node:test";
import type { OhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import { PiSdkTaskExecutionBackend } from "./pi-sdk-backend";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

const config: OhmRuntimeConfig = {
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

defineTest("pi-sdk-backend executes start with runner", async () => {
  const backend = new PiSdkTaskExecutionBackend(async () => {
    return {
      output: "sdk output",
      events: [],
      timedOut: false,
      aborted: false,
      runtime: "pi-sdk",
    };
  });

  const result = await backend.executeStart({
    taskId: "task_sdk_1",
    subagent: {
      id: "finder",
      name: "Finder",
      summary: "Search specialist",
      whenToUse: ["search"],
      scaffoldPrompt: "search prompt",
      primary: false,
    },
    description: "sdk smoke",
    prompt: "find auth",
    cwd: "/tmp/project",
    config,
    signal: undefined,
  });

  assert.equal(Result.isOk(result), true);
  if (Result.isError(result)) {
    assert.fail("Expected sdk backend success");
  }

  assert.equal(result.value.runtime, "pi-sdk");
  assert.equal(result.value.route, "interactive-sdk");
});

defineTest("pi-sdk-backend forwards observability callback during start", async () => {
  const backend = new PiSdkTaskExecutionBackend(async (input) => {
    input.onObservability?.({
      provider: "openai",
      model: "gpt-5",
      runtime: "pi-sdk",
      route: "interactive-sdk",
      promptProfile: "openai",
      promptProfileSource: "active_model",
      promptProfileReason: "active_model_direct_match",
    });

    return {
      output: "sdk output",
      events: [],
      timedOut: false,
      aborted: false,
      runtime: "pi-sdk",
    };
  });

  const observed: string[] = [];
  const result = await backend.executeStart({
    taskId: "task_sdk_observe_1",
    subagent: {
      id: "finder",
      name: "Finder",
      summary: "Search specialist",
      whenToUse: ["search"],
      scaffoldPrompt: "search prompt",
      primary: false,
    },
    description: "sdk observability",
    prompt: "find auth",
    cwd: "/tmp/project",
    config,
    signal: undefined,
    onObservability: (observability) => {
      observed.push(
        [
          observability.provider ?? "",
          observability.model ?? "",
          observability.promptProfile ?? "",
        ].join(":"),
      );
    },
  });

  assert.equal(Result.isOk(result), true);
  assert.deepEqual(observed, ["openai:gpt-5:openai"]);
});
