import assert from "node:assert/strict";
import test from "node:test";
import { getSubagentInvocationMode, normalizeCommandArgs } from "./extension";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

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
