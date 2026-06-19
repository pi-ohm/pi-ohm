import assert from "node:assert/strict";
import test from "node:test";
import { parseGoalCommand } from "../commands";
import type { Goal } from "../model";
import { formatGoalStatus, renderGoalReport } from "../ui";

void test("parseGoalCommand handles Codex-compatible goal commands", () => {
  assert.deepEqual(parseGoalCommand(""), { kind: "show" });
  assert.deepEqual(parseGoalCommand("pause"), { kind: "pause" });
  assert.deepEqual(parseGoalCommand("resume"), { kind: "resume" });
  assert.deepEqual(parseGoalCommand("clear"), { kind: "clear" });
  assert.deepEqual(parseGoalCommand("edit clarify objective"), {
    kind: "edit",
    objective: "clarify objective",
  });
  assert.deepEqual(parseGoalCommand("ship package"), {
    kind: "set",
    objective: "ship package",
  });
});

void test("formatGoalStatus renders persistent input-border text", () => {
  const goal = {
    sessionId: "session-1",
    goalId: "goal-1",
    objective: "ship goal",
    status: "active",
    tokensUsed: 0,
    timeUsedSeconds: 34,
    createdAtMs: 1_000,
    updatedAtMs: 2_000,
  } satisfies Goal;

  assert.equal(formatGoalStatus(goal), "Pursuing goal (34s)");
  assert.match(renderGoalReport(goal), /objective: ship goal/);
});
