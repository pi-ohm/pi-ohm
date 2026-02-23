import assert from "node:assert/strict";
import test from "node:test";
import { Result } from "better-result";
import {
  parseSubagentProfileOverride,
  parseTaskRuntimeConfigFragment,
  SubagentProfileOverrideSchema,
  TaskRuntimeConfigFragmentSchema,
} from "../runtime-config";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("runtime-config parser returns defaults", () => {
  const parsed = parseTaskRuntimeConfigFragment(undefined);
  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) {
    assert.fail("Expected runtime config defaults to parse");
  }

  assert.deepEqual(parsed.value, {
    maxConcurrency: 3,
    widgetMaxItems: 5,
    statusUpdateIntervalMs: 750,
  });
});

defineTest("profile override parser accepts valid override", () => {
  const parsed = parseSubagentProfileOverride({
    id: "finder",
    model: "openai/gpt-5-mini",
  });
  assert.equal(Result.isOk(parsed), true);
});

defineTest("raw runtime-config schemas remain usable", () => {
  const configResult = TaskRuntimeConfigFragmentSchema.safeParse({});
  const profileResult = SubagentProfileOverrideSchema.safeParse({
    id: "finder",
  });
  assert.equal(configResult.success, true);
  assert.equal(profileResult.success, true);
});
