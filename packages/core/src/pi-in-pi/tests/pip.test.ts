import assert from "node:assert/strict";
import test from "node:test";
import { Result } from "better-result";
import { ExtensionDb } from "../../db";
import {
  createInMemoryPipGraphStore,
  createPipGraphStore,
  PipController,
  pipDbModule,
  type PipRunner,
} from "../index";

function createFakeRunner(): PipRunner {
  return {
    async spawn(input) {
      return Result.ok({
        pipId: input.pipId,
        ownerPackage: input.ownerPackage,
        role: input.role,
        parentSessionId: input.parentSessionId,
        childSessionId: `child-${input.pipId}`,
        childSessionFile: `/tmp/${input.pipId}.jsonl`,
        status: { state: "completed", result: "ok" },
      });
    },
    async send(input) {
      return Result.ok({ pipId: input.pipId, status: { state: "completed", result: "sent" } });
    },
    async wait(input) {
      return Result.ok({
        statuses: Object.fromEntries(
          input.pipIds.map((pipId) => [pipId, { state: "completed", result: "ok" }]),
        ),
        timedOut: false,
      });
    },
    async get(input) {
      return Result.ok({
        pipId: input.pipId,
        status: { state: "completed", result: "ok" },
        childSessionId: `child-${input.pipId}`,
        childSessionFile: `/tmp/${input.pipId}.jsonl`,
      });
    },
    async close(input) {
      return Result.ok({
        pipId: input.pipId,
        previousStatus: { state: "completed", result: "ok" },
      });
    },
    async resume(input) {
      return Result.ok({ pipId: input.pipId, status: { state: "running" } });
    },
  };
}

void test("PipController spawns through runner and stores graph metadata", async () => {
  const graph = createInMemoryPipGraphStore();
  const entries: unknown[] = [];
  const controller = new PipController({
    runner: createFakeRunner(),
    graph,
    createId: () => "pip-test",
    now: () => 123,
    entries: {
      write(entry) {
        entries.push(entry);
        return Result.ok("entry-1");
      },
    },
  });

  const spawned = await controller.spawn({
    ownerPackage: "@demo/subagents",
    role: "reviewer",
    parentSessionId: "parent-1",
    cwd: "/tmp/demo",
    prompt: "review this",
  });

  assert.equal(Result.isOk(spawned), true);
  if (Result.isError(spawned)) assert.fail(spawned.error.message);
  assert.equal(spawned.value.pipId, "pip-test");

  const stored = await graph.get("pip-test");
  assert.equal(Result.isOk(stored), true);
  if (Result.isError(stored)) assert.fail(stored.error.message);
  assert.equal(stored.value?.ownerPackage, "@demo/subagents");
  assert.equal(stored.value?.role, "reviewer");
  assert.equal(entries.length, 1);
});

void test("createPipGraphStore persists and reads PiP edges", async () => {
  const db = await ExtensionDb.open({ url: "file::memory:" });
  assert.equal(Result.isOk(db), true);
  if (Result.isError(db)) assert.fail(db.error.message);

  const migrated = await db.value.migrate({ modules: [pipDbModule] });
  assert.equal(Result.isOk(migrated), true);
  if (Result.isError(migrated)) assert.fail(migrated.error.message);

  const graph = createPipGraphStore(db.value);
  const stored = await graph.upsert({
    pipId: "pip-db",
    ownerPackage: "@demo/memories",
    role: "memory-writer",
    parentSessionId: "parent-db",
    childSessionId: "child-db",
    childSessionFile: "/tmp/child.jsonl",
    status: { state: "completed", result: "done" },
    createdAtEpochMs: 1,
    updatedAtEpochMs: 2,
  });
  assert.equal(Result.isOk(stored), true);
  if (Result.isError(stored)) assert.fail(stored.error.message);

  const edge = await graph.get("pip-db");
  assert.equal(Result.isOk(edge), true);
  if (Result.isError(edge)) assert.fail(edge.error.message);
  assert.equal(edge.value?.ownerPackage, "@demo/memories");
  assert.deepEqual(edge.value?.status, { state: "completed", result: "done" });

  db.value.close();
});
