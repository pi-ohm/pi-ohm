import assert from "node:assert/strict";
import test from "node:test";
import { Result } from "better-result";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ExtensionDb } from "../../db";
import {
  createInMemoryPipGraphStore,
  createPipGraphStore,
  extractPipParentEntries,
  parsePipParentEntry,
  PipController,
  pipDbModule,
  resolvePipNamespace,
  resolvePipSessionFile,
  type PipRunner,
} from "../index";
import { setPrompt } from "../experimental";

const PipEntryKindSchema = Type.Object(
  { kind: Type.Optional(Type.Unknown()) },
  { additionalProperties: true },
);

function entryKind(entry: unknown): unknown {
  if (!Value.Check(PipEntryKindSchema, entry)) return null;
  return entry.kind;
}

function createFakeRunner(): PipRunner {
  return {
    async spawn(input) {
      return Result.ok({
        pipId: input.pipId,
        ownerPackage: input.ownerPackage,
        role: input.role,
        parentSessionId: input.parentSessionId,
        childSessionId: `child-${input.pipId}`,
        childSessionPath: `sessions/demo/${input.pipId}.jsonl`,
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
        childSessionPath: `sessions/demo/${input.pipId}.jsonl`,
      });
    },
    async close(input) {
      return Result.ok({
        pipId: input.pipId,
        previousStatus: { state: "completed", result: "ok" },
      });
    },
    async abort(input) {
      return Result.ok({ pipId: input.pipId, status: { state: "interrupted" } });
    },
    async resume(input) {
      return Result.ok({ pipId: input.pipId, status: { state: "running" } });
    },
  };
}

function createRunningRunner(): PipRunner {
  return {
    async spawn(input) {
      return Result.ok({
        pipId: input.pipId,
        ownerPackage: input.ownerPackage,
        role: input.role,
        parentSessionId: input.parentSessionId,
        childSessionId: `child-${input.pipId}`,
        childSessionPath: `sessions/demo/${input.pipId}.jsonl`,
        status: { state: "running" },
      });
    },
    async send(input) {
      return Result.ok({ pipId: input.pipId, status: { state: "running" } });
    },
    async wait(input) {
      return Result.ok({
        statuses: Object.fromEntries(input.pipIds.map((pipId) => [pipId, { state: "running" }])),
        timedOut: true,
      });
    },
    async get(input) {
      return Result.ok({
        pipId: input.pipId,
        status: { state: "running" },
        childSessionId: `child-${input.pipId}`,
        childSessionPath: `sessions/demo/${input.pipId}.jsonl`,
      });
    },
    async close(input) {
      return Result.ok({ pipId: input.pipId, previousStatus: { state: "running" } });
    },
    async abort(input) {
      return Result.ok({ pipId: input.pipId, status: { state: "interrupted" } });
    },
    async resume(input) {
      return Result.ok({ pipId: input.pipId, status: { state: "running" } });
    },
  };
}

void test("PipController spawns through runner and writes hidden lifecycle entries", async () => {
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
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => entryKind(entry)),
    ["pip_spawn_requested", "pip_spawned"],
  );
});

void test("PipController forwards background spawn intent to runner", async () => {
  const seen: boolean[] = [];
  const runner = createFakeRunner();
  const controller = new PipController({
    runner: {
      ...runner,
      async spawn(input) {
        seen.push(input.runInBackground ?? false);
        return runner.spawn(input);
      },
    },
    createId: () => "pip-bg",
  });

  const spawned = await controller.spawn({
    ownerPackage: "@demo/subagents",
    role: "reviewer",
    parentSessionId: "parent-1",
    cwd: "/tmp/demo",
    prompt: "review this",
    runInBackground: true,
  });

  assert.equal(Result.isOk(spawned), true);
  if (Result.isError(spawned)) assert.fail(spawned.error.message);
  assert.deepEqual(seen, [true]);
});

void test("PipController accepts prompt objects and forwards text to runner", async () => {
  const prompts: string[] = [];
  const sends: string[] = [];
  const runner = createFakeRunner();
  const controller = new PipController({
    runner: {
      ...runner,
      async spawn(input) {
        prompts.push(input.prompt ?? "");
        return runner.spawn(input);
      },
      async send(input) {
        sends.push(input.prompt);
        return runner.send(input);
      },
    },
    createId: () => "pip-prompt-object",
  });

  const prompt = setPrompt()`
    Review ${"packages/core/src/pi-in-pi/index.ts"}.
  `;

  const spawned = await controller.spawn({
    ownerPackage: "@demo/subagents",
    role: "reviewer",
    parentSessionId: "parent-1",
    cwd: "/tmp/demo",
    prompt,
  });

  assert.equal(Result.isOk(spawned), true);
  if (Result.isError(spawned)) assert.fail(spawned.error.message);

  const sent = await controller.send({
    pipId: spawned.value.pipId,
    prompt: setPrompt()`Follow up with ${"tests"}.`,
  });

  assert.equal(Result.isOk(sent), true);
  if (Result.isError(sent)) assert.fail(sent.error.message);
  assert.deepEqual(prompts, ["Review packages/core/src/pi-in-pi/index.ts."]);
  assert.deepEqual(sends, ["Follow up with tests."]);
});

void test("PipController wait returns runner timeout status", async () => {
  const controller = new PipController({
    runner: createRunningRunner(),
    createId: () => "pip-running",
  });
  const spawned = await controller.spawn({
    ownerPackage: "@demo/subagents",
    role: "reviewer",
    parentSessionId: "parent-1",
    cwd: "/tmp/demo",
    prompt: "review this",
    runInBackground: true,
  });
  assert.equal(Result.isOk(spawned), true);
  if (Result.isError(spawned)) assert.fail(spawned.error.message);

  const waited = await controller.wait({ pipIds: [spawned.value.pipId], timeoutMs: 1 });
  assert.equal(Result.isOk(waited), true);
  if (Result.isError(waited)) assert.fail(waited.error.message);
  assert.equal(waited.value.timedOut, true);
  assert.deepEqual(waited.value.statuses[spawned.value.pipId], { state: "running" });
});

void test("PipController aborts through runner and records interrupted status", async () => {
  const graph = createInMemoryPipGraphStore();
  const entries: unknown[] = [];
  const aborted: string[] = [];
  const runner = createRunningRunner();
  const controller = new PipController({
    runner: {
      ...runner,
      async abort(input) {
        aborted.push(input.pipId);
        return runner.abort(input);
      },
    },
    graph,
    createId: () => "pip-abort",
    now: () => 456,
    entries: {
      write(entry) {
        entries.push(entry);
        return Result.ok("entry-abort");
      },
    },
  });

  const spawned = await controller.spawn({
    ownerPackage: "@demo/subagents",
    role: "reviewer",
    parentSessionId: "parent-1",
    cwd: "/tmp/demo",
    prompt: "review this",
    runInBackground: true,
  });
  assert.equal(Result.isOk(spawned), true);
  if (Result.isError(spawned)) assert.fail(spawned.error.message);

  const result = await controller.abort({ pipId: spawned.value.pipId });
  assert.equal(Result.isOk(result), true);
  if (Result.isError(result)) assert.fail(result.error.message);
  assert.deepEqual(aborted, ["pip-abort"]);
  assert.deepEqual(result.value.status, { state: "interrupted" });

  const stored = await graph.get("pip-abort");
  assert.equal(Result.isOk(stored), true);
  if (Result.isError(stored)) assert.fail(stored.error.message);
  assert.deepEqual(stored.value?.status, { state: "interrupted" });
  assert.equal(
    entries.some((entry) => entryKind(entry) === "pip_status_changed"),
    true,
  );
});

void test("PiP storage resolves safe namespaces and rejects escaped child paths", () => {
  const namespace = resolvePipNamespace({ ownerPackage: "@Demo/Subagents" });
  assert.equal(Result.isOk(namespace), true);
  if (Result.isError(namespace)) assert.fail(namespace.error.message);
  assert.equal(namespace.value, "demo_subagents");

  const escaped = resolvePipSessionFile({ dataDir: "/tmp/ohm", childSessionPath: "../bad.jsonl" });
  assert.equal(Result.isError(escaped), true);
});

void test("PiP parent entries parse hidden custom entry data", () => {
  const parsed = parsePipParentEntry({
    kind: "pip_spawned",
    pipId: "pip-1",
    ownerPackage: "@demo/subagents",
    role: "reviewer",
    parentSessionId: "parent-1",
    childSessionId: "child-1",
    childSessionPath: "sessions/demo/pip-1/child.jsonl",
    status: { state: "running" },
    atEpochMs: 1,
  });

  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) assert.fail(parsed.error.message);
  assert.equal(parsed.value.kind, "pip_spawned");

  const entries = extractPipParentEntries([
    { type: "custom", customType: "other", data: {} },
    { type: "custom", customType: "pi-ohm.pip", data: parsed.value },
  ]);
  assert.equal(Result.isOk(entries), true);
  if (Result.isError(entries)) assert.fail(entries.error.message);
  assert.equal(entries.value.length, 1);
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
    childSessionPath: "sessions/demo/child.jsonl",
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
