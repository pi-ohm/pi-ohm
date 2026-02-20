import assert from "node:assert/strict";
import test from "node:test";
import type { OhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import { ScaffoldTaskExecutionBackend } from "./scaffold-backend";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

const config: OhmRuntimeConfig = {
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

defineTest("scaffold-backend returns deterministic start output", async () => {
  const backend = new ScaffoldTaskExecutionBackend();
  const result = await backend.executeStart({
    taskId: "task_scaffold_1",
    subagent: {
      id: "finder",
      name: "Finder",
      summary: "Search specialist",
      whenToUse: ["search"],
      scaffoldPrompt: "search prompt",
      primary: false,
    },
    description: "scaffold smoke",
    prompt: "find auth",
    cwd: "/tmp/project",
    config,
    signal: undefined,
  });

  assert.equal(Result.isOk(result), true);
  if (Result.isError(result)) {
    assert.fail("Expected scaffold backend success");
  }
  assert.match(result.value.output, /scaffold/i);
});
