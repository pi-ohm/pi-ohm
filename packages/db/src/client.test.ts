import assert from "node:assert/strict";
import { Result } from "better-result";
import { createOhmDb } from "./client";
import { OHM_DB_SCHEMA_VERSION } from "./schema";
import { defineTest } from "./test-fixtures";

defineTest("createOhmDb initializes schema tables", async () => {
  const created = await createOhmDb({ path: ":memory:" });
  if (Result.isError(created)) {
    assert.fail(created.error.message);
  }

  const db = created.value;
  try {
    const schemaVersion = await db.state.get({
      namespace: "__meta",
      key: "schema_version_test",
    });
    if (Result.isError(schemaVersion)) {
      assert.fail(schemaVersion.error.message);
    }

    assert.equal(schemaVersion.value, undefined);
  } finally {
    await db.close();
  }
});

defineTest("state store supports set/get/delete roundtrip", async () => {
  const created = await createOhmDb({ path: ":memory:", now: () => 1700000000000 });
  if (Result.isError(created)) {
    assert.fail(created.error.message);
  }

  const db = created.value;
  try {
    const setResult = await db.state.set({
      namespace: "session",
      key: "active-mode",
      value: {
        mode: "deep",
        schemaVersion: OHM_DB_SCHEMA_VERSION,
      },
      updatedAtEpochMs: 1700000000000,
    });
    if (Result.isError(setResult)) {
      assert.fail(setResult.error.message);
    }

    const getResult = await db.state.get({
      namespace: "session",
      key: "active-mode",
    });
    if (Result.isError(getResult)) {
      assert.fail(getResult.error.message);
    }

    assert.deepEqual(getResult.value, {
      mode: "deep",
      schemaVersion: OHM_DB_SCHEMA_VERSION,
    });

    const deleteResult = await db.state.delete({
      namespace: "session",
      key: "active-mode",
    });
    if (Result.isError(deleteResult)) {
      assert.fail(deleteResult.error.message);
    }

    const afterDelete = await db.state.get({
      namespace: "session",
      key: "active-mode",
    });
    if (Result.isError(afterDelete)) {
      assert.fail(afterDelete.error.message);
    }

    assert.equal(afterDelete.value, undefined);
  } finally {
    await db.close();
  }
});

defineTest("subagent session store supports upsert/list/event timeline", async () => {
  const created = await createOhmDb({ path: ":memory:" });
  if (Result.isError(created)) {
    assert.fail(created.error.message);
  }

  const db = created.value;
  try {
    const upsert = await db.subagentSessions.upsert({
      snapshot: {
        id: "task_1",
        projectCwd: "/tmp/repo",
        subagentType: "finder",
        invocation: "task-routed",
        status: "running",
        summary: "finder scanning auth flow",
        createdAtEpochMs: 1700000000000,
        updatedAtEpochMs: 1700000001000,
      },
    });
    if (Result.isError(upsert)) {
      assert.fail(upsert.error.message);
    }

    const appendOne = await db.subagentSessions.appendEvent({
      sessionId: "task_1",
      eventType: "tool_start",
      payload: { toolName: "grep", pattern: "auth" },
      atEpochMs: 1700000001200,
    });
    if (Result.isError(appendOne)) {
      assert.fail(appendOne.error.message);
    }

    const appendTwo = await db.subagentSessions.appendEvent({
      sessionId: "task_1",
      eventType: "assistant_text_delta",
      payload: { delta: "found token validator" },
      atEpochMs: 1700000001300,
    });
    if (Result.isError(appendTwo)) {
      assert.fail(appendTwo.error.message);
    }

    assert.equal(appendOne.value.sequence, 1);
    assert.equal(appendTwo.value.sequence, 2);

    const listed = await db.subagentSessions.list({
      projectCwd: "/tmp/repo",
      limit: 10,
    });
    if (Result.isError(listed)) {
      assert.fail(listed.error.message);
    }

    assert.equal(listed.value.length, 1);
    const [snapshot] = listed.value;
    if (!snapshot) {
      assert.fail("Expected one session snapshot");
    }

    assert.equal(snapshot.id, "task_1");
    assert.equal(snapshot.status, "running");

    const events = await db.subagentSessions.listEvents({
      sessionId: "task_1",
      limit: 10,
    });
    if (Result.isError(events)) {
      assert.fail(events.error.message);
    }

    assert.equal(events.value.length, 2);
    assert.equal(events.value[0]?.sequence, 1);
    assert.equal(events.value[1]?.sequence, 2);
  } finally {
    await db.close();
  }
});
