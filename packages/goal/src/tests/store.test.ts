import assert from "node:assert/strict";
import test from "node:test";
import { Result } from "better-result";
import { ExtensionDb } from "@pi-ohm/core/db";
import { createGoalStore, goalDbModule } from "../index";

async function openStore() {
  const db = await ExtensionDb.open({ url: "file::memory:" });
  assert.equal(Result.isOk(db), true);
  if (Result.isError(db)) assert.fail(db.error.message);

  const migrated = await db.value.migrate({ modules: [goalDbModule] });
  assert.equal(Result.isOk(migrated), true);
  if (Result.isError(migrated)) assert.fail(migrated.error.message);

  return { db: db.value, store: createGoalStore(db.value) };
}

void test("GoalStore creates, reads, and clears a session goal", async () => {
  const opened = await openStore();

  const created = await opened.store.create({
    sessionId: "session-1",
    goalId: "goal-1",
    objective: "ship the goal package",
    tokenBudget: 50_000,
    now: 1_000,
    replaceExisting: true,
    source: "user",
  });
  assert.equal(Result.isOk(created), true);
  if (Result.isError(created)) assert.fail(created.error.message);
  assert.equal(created.value.status, "active");
  assert.equal(created.value.tokenBudget, 50_000);

  const found = await opened.store.get("session-1");
  assert.equal(Result.isOk(found), true);
  if (Result.isError(found)) assert.fail(found.error.message);
  assert.equal(found.value?.objective, "ship the goal package");

  const cleared = await opened.store.clear({
    sessionId: "session-1",
    goalId: "goal-1",
    now: 2_000,
  });
  assert.equal(Result.isOk(cleared), true);
  if (Result.isError(cleared)) assert.fail(cleared.error.message);
  assert.equal(cleared.value, true);

  const missing = await opened.store.get("session-1");
  assert.equal(Result.isOk(missing), true);
  if (Result.isError(missing)) assert.fail(missing.error.message);
  assert.equal(missing.value, undefined);

  opened.db.close();
});

void test("GoalStore rejects model-created goals while an unfinished goal exists", async () => {
  const opened = await openStore();

  const first = await opened.store.create({
    sessionId: "session-2",
    goalId: "goal-1",
    objective: "finish first",
    now: 1_000,
    replaceExisting: false,
    source: "model",
  });
  assert.equal(Result.isOk(first), true);
  if (Result.isError(first)) assert.fail(first.error.message);

  const conflict = await opened.store.create({
    sessionId: "session-2",
    goalId: "goal-2",
    objective: "start second",
    now: 2_000,
    replaceExisting: false,
    source: "model",
  });
  assert.equal(Result.isError(conflict), true);
  if (Result.isOk(conflict)) assert.fail("Expected unfinished goal conflict");
  assert.equal(conflict.error.code, "goal_conflict");

  const completed = await opened.store.setStatus({
    sessionId: "session-2",
    goalId: "goal-1",
    status: "complete",
    now: 3_000,
    eventKind: "goal_completed",
  });
  assert.equal(Result.isOk(completed), true);
  if (Result.isError(completed)) assert.fail(completed.error.message);

  const next = await opened.store.create({
    sessionId: "session-2",
    goalId: "goal-2",
    objective: "start second",
    now: 4_000,
    replaceExisting: false,
    source: "model",
  });
  assert.equal(Result.isOk(next), true);
  if (Result.isError(next)) assert.fail(next.error.message);
  assert.equal(next.value.goalId, "goal-2");

  opened.db.close();
});

void test("GoalStore guards stale goal ids", async () => {
  const opened = await openStore();

  const created = await opened.store.create({
    sessionId: "session-3",
    goalId: "goal-live",
    objective: "live goal",
    now: 1_000,
    replaceExisting: true,
    source: "user",
  });
  assert.equal(Result.isOk(created), true);
  if (Result.isError(created)) assert.fail(created.error.message);

  const stale = await opened.store.setStatus({
    sessionId: "session-3",
    goalId: "goal-stale",
    status: "complete",
    now: 2_000,
    eventKind: "goal_completed",
  });
  assert.equal(Result.isError(stale), true);
  if (Result.isOk(stale)) assert.fail("Expected stale goal id failure");
  assert.equal(stale.error.code, "goal_stale");

  opened.db.close();
});

void test("GoalStore accounts tokens and transitions to budget_limited in the DB write path", async () => {
  const opened = await openStore();

  const created = await opened.store.create({
    sessionId: "session-4",
    goalId: "goal-budget",
    objective: "spend tokens",
    tokenBudget: 100,
    now: 1_000,
    replaceExisting: true,
    source: "user",
  });
  assert.equal(Result.isOk(created), true);
  if (Result.isError(created)) assert.fail(created.error.message);

  const accounted = await opened.store.accountUsage({
    sessionId: "session-4",
    goalId: "goal-budget",
    tokenDelta: 120,
    timeDeltaSeconds: 34,
    turnKey: "leaf:1",
    now: 2_000,
  });
  assert.equal(Result.isOk(accounted), true);
  if (Result.isError(accounted)) assert.fail(accounted.error.message);
  assert.equal(accounted.value.tokensUsed, 120);
  assert.equal(accounted.value.timeUsedSeconds, 34);
  assert.equal(accounted.value.status, "budget_limited");

  opened.db.close();
});
