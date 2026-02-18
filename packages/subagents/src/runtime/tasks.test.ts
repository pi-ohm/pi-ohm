import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Result } from "better-result";
import type { OhmSubagentDefinition } from "../catalog";
import { createInMemoryTaskRuntimeStore, createJsonTaskRuntimePersistence } from "./tasks";

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

function makeStoreWithClock() {
  let now = 1000;
  const store = createInMemoryTaskRuntimeStore({
    now: () => now,
  });

  const tick = (step: number) => {
    now += step;
    return now;
  };

  return {
    store,
    tick,
  };
}

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "pi-ohm-subagents-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

defineTest("createTask creates queued task snapshot", () => {
  const { store } = makeStoreWithClock();
  const created = store.createTask({
    taskId: "task_1",
    subagent: finderSubagent,
    description: "Auth flow scan",
    prompt: "Trace auth validation",
    backend: "scaffold",
    invocation: "task-routed",
  });

  assert.equal(Result.isOk(created), true);
  if (Result.isError(created)) {
    assert.fail("Expected createTask to succeed");
  }

  assert.equal(created.value.id, "task_1");
  assert.equal(created.value.state, "queued");
  assert.equal(created.value.summary, "Queued Finder: Auth flow scan");
  assert.equal(created.value.activeToolCalls, 0);
  assert.equal(created.value.totalToolCalls, 0);
});

defineTest("createTask rejects duplicate task ids", () => {
  const { store } = makeStoreWithClock();

  const first = store.createTask({
    taskId: "task_1",
    subagent: finderSubagent,
    description: "Auth flow scan",
    prompt: "Trace auth validation",
    backend: "scaffold",
    invocation: "task-routed",
  });

  const second = store.createTask({
    taskId: "task_1",
    subagent: finderSubagent,
    description: "Another task",
    prompt: "prompt",
    backend: "scaffold",
    invocation: "task-routed",
  });

  assert.equal(Result.isOk(first), true);
  assert.equal(Result.isError(second), true);
  if (Result.isOk(second)) {
    assert.fail("Expected duplicate task id rejection");
  }

  assert.equal(second.error.code, "duplicate_task_id");
});

defineTest("state machine enforces legal transitions", () => {
  const { store, tick } = makeStoreWithClock();

  const created = store.createTask({
    taskId: "task_1",
    subagent: finderSubagent,
    description: "Auth flow scan",
    prompt: "Trace auth validation",
    backend: "scaffold",
    invocation: "task-routed",
  });

  assert.equal(Result.isOk(created), true);

  tick(50);
  const running = store.markRunning("task_1", "Starting Finder: Auth flow scan");
  assert.equal(Result.isOk(running), true);
  if (Result.isError(running)) {
    assert.fail("Expected running transition");
  }

  assert.equal(running.value.state, "running");
  assert.equal(running.value.activeToolCalls, 1);
  assert.equal(running.value.totalToolCalls, 1);

  tick(75);
  const succeeded = store.markSucceeded("task_1", "Finder: Auth flow scan", "output text");
  assert.equal(Result.isOk(succeeded), true);
  if (Result.isError(succeeded)) {
    assert.fail("Expected succeeded transition");
  }

  assert.equal(succeeded.value.state, "succeeded");
  assert.equal(succeeded.value.activeToolCalls, 0);
  assert.equal(succeeded.value.endedAtEpochMs, 1125);
  assert.equal(succeeded.value.output, "output text");

  const illegal = store.markRunning("task_1", "Should fail");
  assert.equal(Result.isError(illegal), true);
  if (Result.isOk(illegal)) {
    assert.fail("Expected illegal transition to fail");
  }

  assert.equal(illegal.error.code, "illegal_task_state_transition");
});

defineTest(
  "markInteractionRunning and markInteractionComplete update active task without terminal transition",
  () => {
    const { store, tick } = makeStoreWithClock();

    const created = store.createTask({
      taskId: "task_1",
      subagent: finderSubagent,
      description: "Auth flow scan",
      prompt: "Trace auth validation",
      backend: "scaffold",
      invocation: "task-routed",
    });
    assert.equal(Result.isOk(created), true);

    tick(10);
    const running = store.markInteractionRunning(
      "task_1",
      "Continuing Finder: Auth flow scan",
      "Now include tests",
    );
    assert.equal(Result.isOk(running), true);
    if (Result.isError(running)) {
      assert.fail("Expected interaction start to succeed");
    }

    assert.equal(running.value.state, "running");
    assert.equal(running.value.totalToolCalls, 1);
    assert.deepEqual(running.value.followUpPrompts, ["Now include tests"]);

    tick(20);
    const completed = store.markInteractionComplete(
      "task_1",
      "Finder follow-up complete",
      "Follow-up output",
    );
    assert.equal(Result.isOk(completed), true);
    if (Result.isError(completed)) {
      assert.fail("Expected interaction completion to succeed");
    }

    assert.equal(completed.value.state, "running");
    assert.equal(completed.value.activeToolCalls, 0);
    assert.equal(completed.value.output, "Follow-up output");
  },
);

defineTest("markFailed requires terminal metadata and stores error info", () => {
  const { store, tick } = makeStoreWithClock();

  const created = store.createTask({
    taskId: "task_1",
    subagent: finderSubagent,
    description: "Auth flow scan",
    prompt: "Trace auth validation",
    backend: "scaffold",
    invocation: "task-routed",
  });

  assert.equal(Result.isOk(created), true);

  tick(10);
  const running = store.markRunning("task_1", "Starting Finder");
  assert.equal(Result.isOk(running), true);

  tick(10);
  const failed = store.markFailed(
    "task_1",
    "Finder execution failed",
    "backend_failed",
    "backend execution failed",
  );

  assert.equal(Result.isOk(failed), true);
  if (Result.isError(failed)) {
    assert.fail("Expected markFailed to succeed");
  }

  assert.equal(failed.value.state, "failed");
  assert.equal(failed.value.errorCode, "backend_failed");
  assert.equal(failed.value.errorMessage, "backend execution failed");
  assert.equal(failed.value.activeToolCalls, 0);
});

defineTest("markCancelled is idempotent for terminal tasks", () => {
  const { store, tick } = makeStoreWithClock();

  const created = store.createTask({
    taskId: "task_1",
    subagent: finderSubagent,
    description: "Auth flow scan",
    prompt: "Trace auth validation",
    backend: "scaffold",
    invocation: "task-routed",
  });

  assert.equal(Result.isOk(created), true);

  const controller = new AbortController();
  const bindAbort = store.setAbortController("task_1", controller);
  assert.equal(Result.isOk(bindAbort), true);

  tick(10);
  const running = store.markRunning("task_1", "Running Finder");
  assert.equal(Result.isOk(running), true);

  tick(10);
  const cancelled = store.markCancelled("task_1", "Task cancelled by request");
  assert.equal(Result.isOk(cancelled), true);
  if (Result.isError(cancelled)) {
    assert.fail("Expected cancel transition");
  }

  assert.equal(cancelled.value.state, "cancelled");
  assert.equal(controller.signal.aborted, true);

  const cancelledAgain = store.markCancelled("task_1", "Task cancelled by request");
  assert.equal(Result.isOk(cancelledAgain), true);
  if (Result.isError(cancelledAgain)) {
    assert.fail("Expected idempotent cancel");
  }

  assert.equal(cancelledAgain.value.state, "cancelled");
});

defineTest("getTasks returns mixed found/unknown lookup entries", () => {
  const { store } = makeStoreWithClock();

  const created = store.createTask({
    taskId: "task_1",
    subagent: finderSubagent,
    description: "Auth flow scan",
    prompt: "Trace auth validation",
    backend: "scaffold",
    invocation: "task-routed",
  });

  assert.equal(Result.isOk(created), true);

  const lookups = store.getTasks(["task_1", "task_unknown"]);
  assert.equal(lookups.length, 2);

  const [known, unknown] = lookups;
  assert.equal(known.found, true);
  assert.equal(known.snapshot?.id, "task_1");

  assert.equal(unknown.found, false);
  assert.equal(unknown.errorCode, "unknown_task_id");
});

defineTest("setExecutionPromise and getExecutionPromise round-trip", async () => {
  const { store } = makeStoreWithClock();

  const created = store.createTask({
    taskId: "task_1",
    subagent: finderSubagent,
    description: "Auth flow scan",
    prompt: "Trace auth validation",
    backend: "scaffold",
    invocation: "task-routed",
  });

  assert.equal(Result.isOk(created), true);

  let resolved = false;
  const execution = Promise.resolve().then(() => {
    resolved = true;
  });

  const setPromise = store.setExecutionPromise("task_1", execution);
  assert.equal(Result.isOk(setPromise), true);

  const loaded = store.getExecutionPromise("task_1");
  assert.notEqual(loaded, undefined);

  if (loaded) {
    await loaded;
  }

  assert.equal(resolved, true);
});

defineTest("persistence restores snapshots across store instances", () => {
  withTempDir((dir) => {
    const filePath = join(dir, "tasks.json");
    let now = 1000;

    const persistence = createJsonTaskRuntimePersistence(filePath);

    const storeOne = createInMemoryTaskRuntimeStore({
      now: () => now,
      persistence,
    });

    const created = storeOne.createTask({
      taskId: "task_1",
      subagent: finderSubagent,
      description: "Auth flow scan",
      prompt: "Trace auth validation",
      backend: "scaffold",
      invocation: "task-routed",
    });
    assert.equal(Result.isOk(created), true);

    now += 5;
    const running = storeOne.markRunning("task_1", "Starting Finder");
    assert.equal(Result.isOk(running), true);

    now += 5;
    const succeeded = storeOne.markSucceeded("task_1", "Finder done", "done output");
    assert.equal(Result.isOk(succeeded), true);

    const storeTwo = createInMemoryTaskRuntimeStore({
      now: () => now,
      persistence,
    });

    const restored = storeTwo.getTask("task_1");
    assert.notEqual(restored, undefined);
    assert.equal(restored?.state, "succeeded");
    assert.equal(restored?.summary, "Finder done");
    assert.equal(restored?.output, "done output");
  });
});

defineTest("retention policy expires terminal tasks with explicit error reason", () => {
  let now = 1000;
  const store = createInMemoryTaskRuntimeStore({
    now: () => now,
    retentionMs: 25,
  });

  const created = store.createTask({
    taskId: "task_1",
    subagent: finderSubagent,
    description: "Auth flow scan",
    prompt: "Trace auth validation",
    backend: "scaffold",
    invocation: "task-routed",
  });
  assert.equal(Result.isOk(created), true);

  now += 5;
  const running = store.markRunning("task_1", "Starting Finder");
  assert.equal(Result.isOk(running), true);

  now += 5;
  const succeeded = store.markSucceeded("task_1", "Finder done", "done output");
  assert.equal(Result.isOk(succeeded), true);

  now += 30;
  const lookup = store.getTasks(["task_1"])[0];
  assert.equal(lookup?.found, false);
  assert.equal(lookup?.errorCode, "task_expired");
  assert.match(String(lookup?.errorMessage), /retention policy/);
});

defineTest("corrupt persistence snapshot falls back to empty store and records diagnostics", () => {
  withTempDir((dir) => {
    const filePath = join(dir, "tasks.json");
    writeFileSync(filePath, "{invalid-json", "utf8");

    const persistence = createJsonTaskRuntimePersistence(filePath);
    const store = createInMemoryTaskRuntimeStore({ persistence });

    const diagnostics = store.getPersistenceDiagnostics();
    assert.equal(diagnostics.length > 0, true);

    const lookups = store.getTasks(["task_missing"]);
    assert.equal(lookups[0]?.found, false);

    const recoveredPath = diagnostics.find((entry) => entry.includes("Recovered corrupt"));
    assert.notEqual(recoveredPath, undefined);

    const recoveredFilePath = recoveredPath?.split(": ").at(-1);
    assert.notEqual(recoveredFilePath, undefined);
    if (recoveredFilePath) {
      assert.equal(existsSync(recoveredFilePath), true);
      const recoveredRaw = readFileSync(recoveredFilePath, "utf8");
      assert.match(recoveredRaw, /invalid-json/);
    }
  });
});
