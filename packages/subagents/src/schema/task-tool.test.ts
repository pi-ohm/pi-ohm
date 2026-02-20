import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";
import { Result } from "better-result";
import { ensureZodV4 } from "./shared";
import {
  SubagentProfileOverrideSchema,
  parseSubagentProfileOverride,
  parseTaskRuntimeConfigFragment,
} from "./runtime-config";
import { TaskRecordSchema, parseTaskRecord } from "./task-record";
import {
  parseTaskToolParameters,
  TaskToolParametersSchema,
  TaskToolRegistrationParametersSchema,
} from "./task-tool";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

const validSingleStartPayload = {
  op: "start",
  subagent_type: "finder",
  description: "Auth flow scan",
  prompt: "Trace token validation + refresh flow",
  async: true,
};

const validBatchStartPayload = {
  op: "start",
  tasks: [
    {
      subagent_type: "finder",
      description: "Auth scan",
      prompt: "Find auth endpoints",
    },
    {
      subagent_type: "oracle",
      description: "Risk review",
      prompt: "Review auth risks",
      async: true,
    },
  ],
  parallel: true,
};

defineTest("ensureZodV4 succeeds in current environment", () => {
  const result = ensureZodV4();
  assert.equal(Result.isOk(result), true);
});

defineTest("TaskToolParametersSchema accepts valid single start payload", () => {
  const isValid = Value.Check(TaskToolParametersSchema, validSingleStartPayload);
  assert.equal(isValid, true);
  assert.equal(Value.Check(TaskToolRegistrationParametersSchema, validSingleStartPayload), true);

  const parsed = parseTaskToolParameters(validSingleStartPayload);
  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) {
    assert.fail("Expected valid single start payload to parse");
  }

  assert.equal(parsed.value.op, "start");
  if (!("description" in parsed.value)) {
    assert.fail("Expected single start payload with description");
  }

  assert.equal(parsed.value.description, "Auth flow scan");
});

defineTest("TaskToolParametersSchema normalizes mixed single+batch start payload to batch", () => {
  const mixedPayload = {
    ...validSingleStartPayload,
    tasks: [
      {
        subagent_type: "finder",
        description: "scan",
        prompt: "prompt",
      },
    ],
  };

  const parsed = parseTaskToolParameters(mixedPayload);
  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) {
    assert.fail("Expected mixed single+batch payload to normalize");
  }

  if (parsed.value.op !== "start" || !("tasks" in parsed.value)) {
    assert.fail("Expected normalized batch payload");
  }

  assert.equal(parsed.value.tasks.length, 1);
});

defineTest("TaskToolParametersSchema accepts valid batch start payload", () => {
  const parsed = parseTaskToolParameters(validBatchStartPayload);
  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) {
    assert.fail("Expected valid batch payload to parse");
  }

  assert.equal(parsed.value.op, "start");
  assert.equal("tasks" in parsed.value, true);
  if (!("tasks" in parsed.value)) {
    assert.fail("Expected parsed batch payload to include tasks");
  }

  assert.equal(parsed.value.tasks.length, 2);
});

defineTest("TaskToolParametersSchema rejects empty batch task list", () => {
  const parsed = parseTaskToolParameters({
    op: "start",
    tasks: [],
    parallel: true,
  });

  assert.equal(Result.isError(parsed), true);
  if (Result.isOk(parsed)) {
    assert.fail("Expected empty batch task list to fail");
  }

  assert.equal(parsed.error.code, "invalid_task_tool_payload");
});

defineTest("TaskToolParametersSchema validates status operation", () => {
  const parsed = parseTaskToolParameters({
    op: "status",
    ids: ["task_1", "task_2"],
  });

  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) {
    assert.fail("Expected status operation to parse");
  }

  assert.equal(parsed.value.op, "status");
});

defineTest("TaskToolParametersSchema normalizes status id alias", () => {
  const parsed = parseTaskToolParameters({
    op: "status",
    id: "task_1",
  });

  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) {
    assert.fail("Expected status id alias to parse");
  }

  if (parsed.value.op !== "status") {
    assert.fail("Expected status payload");
  }

  assert.deepEqual(parsed.value.ids, ["task_1"]);
});

defineTest("TaskToolParametersSchema validates wait operation with timeout", () => {
  const parsed = parseTaskToolParameters({
    op: "wait",
    ids: ["task_1"],
    timeout_ms: 120000,
  });

  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) {
    assert.fail("Expected wait operation to parse");
  }

  assert.equal(parsed.value.op, "wait");
});

defineTest("TaskToolParametersSchema normalizes wait id alias and ignores unrelated fields", () => {
  const parsed = parseTaskToolParameters({
    op: "wait",
    id: "task_1",
    subagent_type: "finder",
    description: "should be ignored",
  });

  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) {
    assert.fail("Expected wait id alias to parse");
  }

  if (parsed.value.op !== "wait") {
    assert.fail("Expected wait payload");
  }

  assert.deepEqual(parsed.value.ids, ["task_1"]);
});

defineTest("TaskToolParametersSchema rejects wait operation with non-positive timeout", () => {
  const parsed = parseTaskToolParameters({
    op: "wait",
    ids: ["task_1"],
    timeout_ms: 0,
  });

  assert.equal(Result.isError(parsed), true);
  if (Result.isOk(parsed)) {
    assert.fail("Expected wait with timeout_ms=0 to fail");
  }

  assert.equal(parsed.error.code, "invalid_task_tool_payload");
});

defineTest("TaskToolParametersSchema validates send and cancel operations", () => {
  const sendParsed = parseTaskToolParameters({
    op: "send",
    id: "task_1",
    prompt: "Continue scan",
  });

  const cancelParsed = parseTaskToolParameters({
    op: "cancel",
    id: "task_1",
  });

  assert.equal(Result.isOk(sendParsed), true);
  assert.equal(Result.isOk(cancelParsed), true);
});

defineTest("TaskToolParametersSchema rejects unknown operation names", () => {
  const parsed = parseTaskToolParameters({
    op: "unknown-op",
    id: "task_1",
  });

  assert.equal(Result.isError(parsed), true);
  if (Result.isOk(parsed)) {
    assert.fail("Expected unknown operation to fail");
  }

  assert.equal(parsed.error.code, "invalid_task_tool_payload");
});

defineTest("TaskToolParametersSchema maps result op alias to status", () => {
  const parsed = parseTaskToolParameters({
    op: "result",
    id: "task_1",
  });

  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) {
    assert.fail("Expected result op alias to parse");
  }

  if (parsed.value.op !== "status") {
    assert.fail("Expected status payload");
  }

  assert.deepEqual(parsed.value.ids, ["task_1"]);
});

defineTest("TaskToolParametersSchema exposes failing path for invalid nested task field", () => {
  const parsed = parseTaskToolParameters({
    op: "start",
    tasks: [
      {
        subagent_type: "finder",
        description: "desc",
        prompt: 123,
      },
    ],
  });

  assert.equal(Result.isError(parsed), true);
  if (Result.isOk(parsed)) {
    assert.fail("Expected nested invalid field to fail");
  }

  assert.equal(parsed.error.path, "tasks.0.prompt");
});

defineTest("TaskRecordSchema accepts active running record and rejects endedAtEpochMs", () => {
  const runningRecord = {
    id: "task_1",
    subagentType: "finder",
    description: "Auth flow scan",
    prompt: "Trace auth",
    state: "running",
    totalToolCalls: 3,
    activeToolCalls: 1,
    startedAtEpochMs: 100,
    updatedAtEpochMs: 120,
  };

  const parsedRunning = parseTaskRecord(runningRecord);
  assert.equal(Result.isOk(parsedRunning), true);

  const invalidRunningRecord = {
    ...runningRecord,
    endedAtEpochMs: 130,
  };

  const parsedInvalidRunning = parseTaskRecord(invalidRunningRecord);
  assert.equal(Result.isError(parsedInvalidRunning), true);
});

defineTest("TaskRecordSchema enforces terminal invariants", () => {
  const invalidTerminalMissingEndedAt = {
    id: "task_1",
    subagentType: "finder",
    description: "Auth flow scan",
    prompt: "Trace auth",
    state: "succeeded",
    totalToolCalls: 3,
    activeToolCalls: 0,
    startedAtEpochMs: 100,
    updatedAtEpochMs: 140,
  };

  const invalidTerminalActiveTools = {
    ...invalidTerminalMissingEndedAt,
    endedAtEpochMs: 140,
    activeToolCalls: 1,
  };

  const invalidFailedWithoutMessage = {
    ...invalidTerminalMissingEndedAt,
    state: "failed",
    endedAtEpochMs: 140,
  };

  const invalidTerminalTimeOrder = {
    ...invalidTerminalMissingEndedAt,
    endedAtEpochMs: 90,
  };

  assert.equal(Result.isError(parseTaskRecord(invalidTerminalMissingEndedAt)), true);
  assert.equal(Result.isError(parseTaskRecord(invalidTerminalActiveTools)), true);
  assert.equal(Result.isError(parseTaskRecord(invalidFailedWithoutMessage)), true);
  assert.equal(Result.isError(parseTaskRecord(invalidTerminalTimeOrder)), true);
});

defineTest("TaskRecordSchema accepts valid failed terminal record", () => {
  const failedRecord = {
    id: "task_1",
    subagentType: "oracle",
    description: "Risk review",
    prompt: "Review auth risks",
    state: "failed",
    totalToolCalls: 2,
    activeToolCalls: 0,
    startedAtEpochMs: 100,
    updatedAtEpochMs: 145,
    endedAtEpochMs: 145,
    lastErrorCode: "provider_failure",
    lastErrorMessage: "Model call timed out",
  };

  const parsed = parseTaskRecord(failedRecord);
  assert.equal(Result.isOk(parsed), true);
});

defineTest("TaskRuntimeConfigFragmentSchema returns defaults when omitted", () => {
  const parsed = parseTaskRuntimeConfigFragment(undefined);
  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) {
    assert.fail("Expected config fragment defaults to parse");
  }

  assert.deepEqual(parsed.value, {
    maxConcurrency: 3,
    widgetMaxItems: 5,
    statusUpdateIntervalMs: 750,
  });
});

defineTest("TaskRuntimeConfigFragmentSchema rejects invalid numeric values", () => {
  const parsed = parseTaskRuntimeConfigFragment({
    maxConcurrency: 0,
    widgetMaxItems: -1,
    statusUpdateIntervalMs: 0,
  });

  assert.equal(Result.isError(parsed), true);
  if (Result.isOk(parsed)) {
    assert.fail("Expected invalid config values to fail");
  }

  assert.equal(parsed.error.code, "invalid_task_runtime_config_fragment");
});

defineTest("SubagentProfileOverrideSchema accepts valid profile override", () => {
  const parsed = parseSubagentProfileOverride({
    id: "librarian",
    description: "Deep code understanding",
    mode: "subagent",
    primary: true,
    model: "openai/gpt-5",
    reasoningEffort: "high",
    prompt: "Be concise and precise",
  });

  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) {
    assert.fail("Expected valid profile override to parse");
  }

  assert.equal(parsed.value.id, "librarian");
  assert.equal(parsed.value.primary, true);
});

defineTest("SubagentProfileOverrideSchema rejects malformed overrides", () => {
  const parsedBlankId = parseSubagentProfileOverride({
    id: "",
  });

  const parsedBadMode = parseSubagentProfileOverride({
    id: "finder",
    mode: "invalid-mode",
  });

  const parsedExtraField = parseSubagentProfileOverride({
    id: "finder",
    prompt: "hello",
    extra: "nope",
  });

  assert.equal(Result.isError(parsedBlankId), true);
  assert.equal(Result.isError(parsedBadMode), true);
  assert.equal(Result.isError(parsedExtraField), true);
});

defineTest("raw schema objects stay aligned with parser behavior", () => {
  assert.equal(Value.Check(TaskToolParametersSchema, validSingleStartPayload), true);
  assert.equal(Value.Check(TaskToolRegistrationParametersSchema, validSingleStartPayload), true);
  assert.equal(Value.Check(TaskToolParametersSchema, { op: "send", id: "task_1" }), false);
  assert.equal(
    Value.Check(TaskToolRegistrationParametersSchema, {
      op: "send",
      id: "task_1",
      extra: "nope",
    }),
    false,
  );

  const runningSchemaResult = TaskRecordSchema.safeParse({
    id: "task_1",
    subagentType: "finder",
    description: "Auth flow scan",
    prompt: "Trace auth",
    state: "queued",
    totalToolCalls: 0,
    activeToolCalls: 0,
    startedAtEpochMs: 100,
    updatedAtEpochMs: 100,
  });

  const profileSchemaResult = SubagentProfileOverrideSchema.safeParse({
    id: "finder",
    model: "openai/gpt-5-mini",
  });

  assert.equal(runningSchemaResult.success, true);
  assert.equal(profileSchemaResult.success, true);
});
