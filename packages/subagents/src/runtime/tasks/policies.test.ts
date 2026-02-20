import assert from "node:assert/strict";
import test from "node:test";
import { isTaskTransitionAllowed, isTerminalTaskState } from "./index";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("task transition policy allows queued->running and running->succeeded", () => {
  assert.equal(isTaskTransitionAllowed("queued", "running"), true);
  assert.equal(isTaskTransitionAllowed("running", "succeeded"), true);
});

defineTest("terminal state policy identifies terminal states", () => {
  assert.equal(isTerminalTaskState("succeeded"), true);
  assert.equal(isTerminalTaskState("failed"), true);
  assert.equal(isTerminalTaskState("cancelled"), true);
  assert.equal(isTerminalTaskState("running"), false);
});
