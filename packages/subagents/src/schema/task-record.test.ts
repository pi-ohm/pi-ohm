import assert from "node:assert/strict";
import test from "node:test";
import { Result } from "better-result";
import { TaskRecordSchema, parseTaskRecord } from "./task-record";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("task-record parser accepts valid running record", () => {
  const parsed = parseTaskRecord({
    id: "task_1",
    subagentType: "finder",
    description: "Auth flow scan",
    prompt: "Trace auth",
    state: "running",
    totalToolCalls: 2,
    activeToolCalls: 1,
    startedAtEpochMs: 100,
    updatedAtEpochMs: 120,
  });

  assert.equal(Result.isOk(parsed), true);
});

defineTest("task-record schema rejects terminal record with active tool calls", () => {
  const schemaResult = TaskRecordSchema.safeParse({
    id: "task_1",
    subagentType: "finder",
    description: "Auth flow scan",
    prompt: "Trace auth",
    state: "succeeded",
    totalToolCalls: 2,
    activeToolCalls: 1,
    startedAtEpochMs: 100,
    updatedAtEpochMs: 140,
    endedAtEpochMs: 140,
  });

  assert.equal(schemaResult.success, false);
});
