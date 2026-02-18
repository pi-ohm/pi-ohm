import assert from "node:assert/strict";
import test from "node:test";
import { createTaskRuntimePresentation, formatElapsed, renderTaskSnapshotLines } from "./ui";
import type { TaskRuntimeSnapshot } from "./tasks";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

function makeSnapshot(overrides: Partial<TaskRuntimeSnapshot> = {}): TaskRuntimeSnapshot {
  return {
    id: "task_1",
    state: "running",
    subagentType: "finder",
    description: "Auth flow scan",
    prompt: "Trace auth validation",
    followUpPrompts: [],
    summary: "Starting Finder: Auth flow scan",
    backend: "scaffold",
    provider: "unavailable",
    model: "unavailable",
    runtime: "scaffold",
    route: "scaffold",
    invocation: "task-routed",
    totalToolCalls: 3,
    activeToolCalls: 1,
    startedAtEpochMs: 1000,
    updatedAtEpochMs: 1200,
    ...overrides,
  };
}

defineTest("formatElapsed renders mm:ss", () => {
  assert.equal(formatElapsed(0), "00:00");
  assert.equal(formatElapsed(19000), "00:19");
  assert.equal(formatElapsed(121000), "02:01");
});

defineTest("renderTaskSnapshotLines renders spinner + tool counts + elapsed", () => {
  const snapshot = makeSnapshot();
  const [line1, line2] = renderTaskSnapshotLines({
    snapshot,
    nowEpochMs: 21000,
  });

  assert.match(line1, /\[finder\] Auth flow scan/);
  assert.match(line2, /Tools 1\/3/);
  assert.match(line2, /Elapsed 00:20/);
});

defineTest("renderTaskSnapshotLines uses terminal markers for completed states", () => {
  const succeeded = makeSnapshot({
    state: "succeeded",
    activeToolCalls: 0,
    endedAtEpochMs: 3000,
  });

  const failed = makeSnapshot({
    state: "failed",
    activeToolCalls: 0,
    endedAtEpochMs: 3000,
  });

  const cancelled = makeSnapshot({
    state: "cancelled",
    activeToolCalls: 0,
    endedAtEpochMs: 3000,
  });

  const [successLine] = renderTaskSnapshotLines({
    snapshot: succeeded,
    nowEpochMs: 9000,
  });

  const [failedLine] = renderTaskSnapshotLines({
    snapshot: failed,
    nowEpochMs: 9000,
  });

  const [cancelledLine] = renderTaskSnapshotLines({
    snapshot: cancelled,
    nowEpochMs: 9000,
  });

  assert.match(successLine, /^✓/);
  assert.match(failedLine, /^✕/);
  assert.match(cancelledLine, /^○/);
});

defineTest("createTaskRuntimePresentation synchronizes status + widget summaries", () => {
  const running = makeSnapshot({
    id: "task_running",
    state: "running",
    activeToolCalls: 2,
    totalToolCalls: 4,
    updatedAtEpochMs: 2000,
  });

  const failed = makeSnapshot({
    id: "task_failed",
    state: "failed",
    activeToolCalls: 0,
    totalToolCalls: 2,
    endedAtEpochMs: 1800,
    updatedAtEpochMs: 1800,
  });

  const presentation = createTaskRuntimePresentation({
    snapshots: [failed, running],
    nowEpochMs: 3000,
    maxItems: 5,
  });

  assert.match(presentation.statusLine, /subagents 1 running/);
  assert.match(presentation.statusLine, /tools 2 active/);
  assert.equal(presentation.widgetLines.length, 4);
  assert.equal(presentation.widgetLines[0]?.includes("task_failed"), false);
  assert.match(presentation.plainText, /Tools/);
});

defineTest("createTaskRuntimePresentation running status includes aggregate counters", () => {
  const running = makeSnapshot({
    id: "task_running",
    state: "running",
    activeToolCalls: 3,
    totalToolCalls: 5,
    updatedAtEpochMs: 3000,
  });

  const succeeded = makeSnapshot({
    id: "task_succeeded",
    state: "succeeded",
    activeToolCalls: 0,
    totalToolCalls: 2,
    endedAtEpochMs: 2600,
    updatedAtEpochMs: 2600,
  });

  const failed = makeSnapshot({
    id: "task_failed",
    state: "failed",
    activeToolCalls: 0,
    totalToolCalls: 1,
    endedAtEpochMs: 2500,
    updatedAtEpochMs: 2500,
  });

  const cancelled = makeSnapshot({
    id: "task_cancelled",
    state: "cancelled",
    activeToolCalls: 0,
    totalToolCalls: 1,
    endedAtEpochMs: 2400,
    updatedAtEpochMs: 2400,
  });

  const presentation = createTaskRuntimePresentation({
    snapshots: [running, succeeded, failed, cancelled],
    nowEpochMs: 3500,
  });

  assert.match(presentation.statusLine, /subagents 1 running/);
  assert.match(presentation.statusLine, /tools 3 active/);
  assert.match(presentation.statusLine, /done 1/);
  assert.match(presentation.statusLine, /failed 1/);
  assert.match(presentation.statusLine, /cancelled 1/);
});

defineTest("createTaskRuntimePresentation applies maxItems and truncation", () => {
  const first = makeSnapshot({ id: "task_1", description: "A".repeat(120), updatedAtEpochMs: 10 });
  const second = makeSnapshot({ id: "task_2", description: "B", updatedAtEpochMs: 9 });

  const presentation = createTaskRuntimePresentation({
    snapshots: [first, second],
    nowEpochMs: 2000,
    maxItems: 1,
    maxWidth: 40,
  });

  assert.equal(presentation.widgetLines.length, 2);
  assert.match(presentation.widgetLines[0] ?? "", /…$/);
});
