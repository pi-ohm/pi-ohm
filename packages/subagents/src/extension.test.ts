import assert from "node:assert/strict";
import test from "node:test";
import type { OhmRuntimeConfig } from "@pi-ohm/config";
import { getSubagentById } from "./catalog";
import { getTaskLiveUiMode, setTaskLiveUiMode } from "./runtime/live-ui";
import {
  buildSubagentDetailText,
  resolveSubagentsLiveUiModeCommand,
  buildSubagentsOverviewText,
  getSubagentInvocationMode,
  normalizeCommandArgs,
  registerSubagentTools,
} from "./extension";

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
  subagents: {
    taskMaxConcurrency: 2,
    taskRetentionMs: 1000,
    permissions: {
      default: "allow",
      subagents: {},
      allowInternalRouting: false,
    },
  },
};

defineTest("normalizeCommandArgs supports array input", () => {
  const parsed = normalizeCommandArgs(["finder", 42, "oracle", null]);
  assert.deepEqual(parsed, ["finder", "oracle"]);
});

defineTest("normalizeCommandArgs splits raw string input", () => {
  const parsed = normalizeCommandArgs(" finder   oracle   librarian ");
  assert.deepEqual(parsed, ["finder", "oracle", "librarian"]);
});

defineTest("normalizeCommandArgs supports envelope args array", () => {
  const parsed = normalizeCommandArgs({
    args: ["finder", 1, "oracle"],
  });

  assert.deepEqual(parsed, ["finder", "oracle"]);
});

defineTest("normalizeCommandArgs supports envelope raw string", () => {
  const parsed = normalizeCommandArgs({
    raw: "finder   oracle",
  });

  assert.deepEqual(parsed, ["finder", "oracle"]);
});

defineTest("normalizeCommandArgs returns empty list for unsupported payloads", () => {
  assert.deepEqual(normalizeCommandArgs(undefined), []);
  assert.deepEqual(normalizeCommandArgs(123), []);
  assert.deepEqual(normalizeCommandArgs({}), []);
});

defineTest("getSubagentInvocationMode returns primary-tool for primary profiles", () => {
  assert.equal(getSubagentInvocationMode(true), "primary-tool");
});

defineTest("getSubagentInvocationMode returns task-routed for non-primary profiles", () => {
  assert.equal(getSubagentInvocationMode(false), "task-routed");
  assert.equal(getSubagentInvocationMode(undefined), "task-routed");
});

defineTest("registerSubagentTools registers task tool + primary tools", () => {
  const registeredTools: string[] = [];

  registerSubagentTools({
    registerTool(definition) {
      registeredTools.push(definition.name);
    },
  });

  assert.equal(registeredTools.includes("task"), true);
  assert.equal(registeredTools.includes("librarian"), true);
  assert.equal(registeredTools.includes("finder"), false);
  assert.equal(registeredTools.includes("oracle"), false);
});

defineTest("buildSubagentsOverviewText preserves command compatibility output", () => {
  const text = buildSubagentsOverviewText({
    config: configFixture,
    loadedFrom: ["/tmp/global/ohm.json"],
  });

  assert.match(text, /Pi OHM: subagents/);
  assert.match(text, /Scaffolded subagents:/);
  assert.match(text, /Use \/ohm-subagent <id> to inspect one profile\./);
  assert.match(text, /loadedFrom: \/tmp\/global\/ohm.json/);
});

defineTest("buildSubagentDetailText preserves detailed subagent view", () => {
  const librarian = getSubagentById("librarian");
  assert.notEqual(librarian, undefined);
  if (!librarian) {
    assert.fail("Expected librarian profile");
  }

  const text = buildSubagentDetailText({
    config: configFixture,
    subagent: librarian,
  });

  assert.match(text, /Subagent: Librarian/);
  assert.match(text, /When to use:/);
  assert.match(text, /Scaffold prompt:/);
});

defineTest("resolveSubagentsLiveUiModeCommand sets requested mode", () => {
  setTaskLiveUiMode("compact");

  const result = resolveSubagentsLiveUiModeCommand(["verbose"]);

  assert.equal(result.ok, true);
  assert.equal(result.mode, "verbose");
  assert.equal(getTaskLiveUiMode(), "verbose");
});

defineTest("resolveSubagentsLiveUiModeCommand rejects invalid mode values", () => {
  setTaskLiveUiMode("compact");

  const result = resolveSubagentsLiveUiModeCommand(["loud"]);

  assert.equal(result.ok, false);
  assert.match(result.message, /off\|compact\|verbose/);
  assert.equal(getTaskLiveUiMode(), "compact");
});
