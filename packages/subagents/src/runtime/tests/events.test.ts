import assert from "node:assert/strict";
import test from "node:test";
import { Result } from "better-result";
import { parseTaskExecutionEventFromSdk } from "../events";

function defineTest(name: string, run: () => void): void {
  void test(name, run);
}

defineTest("parseTaskExecutionEventFromSdk parses assistant text deltas", () => {
  const parsed = parseTaskExecutionEventFromSdk({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "hello",
    },
  });

  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) {
    assert.fail("Expected text delta parse success");
  }
  assert.equal(parsed.value?.type, "assistant_text_delta");
});

defineTest("parseTaskExecutionEventFromSdk parses tool lifecycle events", () => {
  const start = parseTaskExecutionEventFromSdk({
    type: "tool_execution_start",
    toolCallId: "tool_1",
    toolName: "read",
    args: { path: "src/index.ts" },
  });
  assert.equal(Result.isOk(start), true);
  if (Result.isError(start)) {
    assert.fail("Expected tool start parse success");
  }
  assert.equal(start.value?.type, "tool_start");

  const update = parseTaskExecutionEventFromSdk({
    type: "tool_execution_update",
    toolCallId: "tool_1",
    toolName: "read",
    partialResult: { progress: "50%" },
  });
  assert.equal(Result.isOk(update), true);
  if (Result.isError(update)) {
    assert.fail("Expected tool update parse success");
  }
  assert.equal(update.value?.type, "tool_update");

  const end = parseTaskExecutionEventFromSdk({
    type: "tool_execution_end",
    toolCallId: "tool_1",
    toolName: "read",
    result: { ok: true },
    isError: false,
  });
  assert.equal(Result.isOk(end), true);
  if (Result.isError(end)) {
    assert.fail("Expected tool end parse success");
  }
  assert.equal(end.value?.type, "tool_end");
});

defineTest("parseTaskExecutionEventFromSdk parses agent terminal marker", () => {
  const parsed = parseTaskExecutionEventFromSdk({
    type: "agent_end",
  });

  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) {
    assert.fail("Expected agent_end parse success");
  }
  assert.equal(parsed.value?.type, "task_terminal");
});

defineTest("parseTaskExecutionEventFromSdk reports malformed known events", () => {
  const malformed = parseTaskExecutionEventFromSdk({
    type: "tool_execution_end",
    toolName: "read",
  });

  assert.equal(Result.isError(malformed), true);
  if (Result.isOk(malformed)) {
    assert.fail("Expected malformed event parse error");
  }
  assert.equal(malformed.error.code, "invalid_task_execution_event");
});

defineTest("parseTaskExecutionEventFromSdk ignores unsupported events", () => {
  const parsed = parseTaskExecutionEventFromSdk({
    type: "turn_start",
    turnIndex: 1,
  });

  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) {
    assert.fail("Expected unsupported event to be ignored");
  }
  assert.equal(parsed.value, undefined);
});
