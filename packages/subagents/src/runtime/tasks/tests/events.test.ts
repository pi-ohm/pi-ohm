import assert from "node:assert/strict";
import test from "node:test";
import { Result } from "better-result";
import type { OhmSubagentDefinition } from "../../../catalog";
import { createInMemoryTaskRuntimeStore } from "../store";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

const finderSubagent: OhmSubagentDefinition = {
  id: "finder",
  name: "Finder",
  summary: "Search specialist",
  whenToUse: ["search"],
  scaffoldPrompt: "search prompt",
};

defineTest("appendEvents retains bounded event count", () => {
  const store = createInMemoryTaskRuntimeStore({
    maxEventsPerTask: 2,
  });

  const created = store.createTask({
    taskId: "task_events_1",
    subagent: finderSubagent,
    description: "events",
    prompt: "scan",
    backend: "interactive-sdk",
    invocation: "task-routed",
  });
  assert.equal(Result.isOk(created), true);
  if (Result.isError(created)) {
    assert.fail("Expected task creation success");
  }

  const running = store.markRunning("task_events_1", "running");
  assert.equal(Result.isOk(running), true);
  if (Result.isError(running)) {
    assert.fail("Expected task running success");
  }

  const appended = store.appendEvents("task_events_1", [
    {
      type: "assistant_text_delta",
      delta: "a",
      atEpochMs: 1,
    },
    {
      type: "assistant_text_delta",
      delta: "b",
      atEpochMs: 2,
    },
    {
      type: "assistant_text_delta",
      delta: "c",
      atEpochMs: 3,
    },
  ]);

  assert.equal(Result.isOk(appended), true);
  if (Result.isError(appended)) {
    assert.fail("Expected appendEvents success");
  }
  assert.equal(appended.value.events.length, 2);
});
