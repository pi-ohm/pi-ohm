import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  AuthStorage,
  ModelRegistry,
  type ExtensionFactory,
  type SessionEntry,
  type SessionHeader,
} from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import {
  Forker,
  createBranchSummaryForkEntries,
  createCompactionForkEntries,
  createPiCompact,
  sliceForkEntries,
  type ForkerAuthResult,
  type ForkerBeforeCompactInput,
  type ForkerCompactInput,
  type ForkerInput,
  type ForkerModelRegistry,
} from "../forker";

const timestamp = "2026-01-01T00:00:00.000Z";
const SessionHeaderCandidateSchema = Type.Object(
  {
    type: Type.Literal("session"),
    id: Type.String(),
  },
  { additionalProperties: true },
);
const SessionEntryCandidateSchema = Type.Object(
  {
    id: Type.String(),
    type: Type.String(),
  },
  { additionalProperties: true },
);
const parentHeader = {
  type: "session",
  version: 3,
  id: "parent-session",
  timestamp,
  cwd: "/tmp/repo",
} satisfies SessionHeader;
const model = {
  id: "main-model",
  name: "Main Model",
  api: "external-main-provider",
  provider: "external-main-provider",
  baseUrl: "https://main-provider.example/v1",
  reasoning: true,
  input: ["text"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 200000,
  maxTokens: 20000,
} satisfies Model<Api>;

void test("sliceForkEntries keeps last N user turns and re-parents the suffix", () => {
  const entries = [
    customEntry("startup", null),
    userEntry("u1", "startup", "one"),
    customEntry("tool1", "u1"),
    userEntry("u2", "tool1", "two"),
    customEntry("tool2", "u2"),
    userEntry("u3", "tool2", "three"),
  ];

  const sliced = sliceForkEntries(entries, 2);

  assert.deepEqual(
    sliced.map((entry) => entry.id),
    ["u2", "tool2", "u3"],
  );
  assert.deepEqual(
    sliced.map((entry) => entry.parentId),
    [null, "u2", "tool2"],
  );
});

void test("createBranchSummaryForkEntries creates a branch_summary-only bootstrap", () => {
  const entries = [userEntry("u1", null, "one"), customEntry("tool1", "u1")];
  const source = createBranchSummaryForkEntries({
    entries,
    summary: "branch summary",
    readFiles: ["packages/subagents/src/agent-controller.ts"],
    modifiedFiles: ["packages/subagents/src/schema.ts"],
    id: "summary1",
    timestamp,
  });

  assert.deepEqual(source, [
    {
      type: "branch_summary",
      id: "summary1",
      parentId: null,
      timestamp,
      fromId: "tool1",
      summary: "branch summary",
      details: {
        readFiles: ["packages/subagents/src/agent-controller.ts"],
        modifiedFiles: ["packages/subagents/src/schema.ts"],
      },
    },
  ]);
});

void test("createCompactionForkEntries roots compaction and keeps retained suffix", () => {
  const entries = [
    userEntry("u1", null, "one"),
    customEntry("tool1", "u1"),
    userEntry("u2", "tool1", "two"),
    customEntry("tool2", "u2"),
  ];
  const source = createCompactionForkEntries({
    entries,
    summary: "compact summary",
    firstKeptEntryId: "u2",
    tokensBefore: 123,
    details: { readFiles: ["README.md"], modifiedFiles: [] },
    fromHook: true,
    id: "compact1",
    timestamp,
  });

  assert.deepEqual(
    source.map((entry) => entry.id),
    ["compact1", "u2", "tool2"],
  );
  assert.deepEqual(
    source.map((entry) => entry.parentId),
    [null, "compact1", "u2"],
  );
  assert.deepEqual(source[0], {
    type: "compaction",
    id: "compact1",
    parentId: null,
    timestamp,
    summary: "compact summary",
    firstKeptEntryId: "u2",
    tokensBefore: 123,
    details: { readFiles: ["README.md"], modifiedFiles: [] },
    fromHook: true,
  });
});

void test("Forker creates a fresh result without writing a source file for no fork", async () => {
  await withForker(async ({ forker }) => {
    const result = await forker.create({
      cwd: "/tmp/repo",
      fork: { kind: "none" },
      strategy: "branch",
      source: { header: parentHeader, entries: [userEntry("u1", null, "one")] },
    });

    assert.equal(Result.isOk(result), true);
    if (Result.isError(result)) assert.fail(result.error.message);
    assert.equal(result.value.mode, "fresh");
    assert.equal(result.value.sourceFile, undefined);
    assert.deepEqual(result.value.entries, []);
    assert.equal(result.value.warning, undefined);
  });
});

void test("Forker writes raw fork as standard Pi session JSONL with a new session id", async () => {
  await withForker(async ({ forker }) => {
    const result = await forker.create({
      cwd: "/tmp/repo",
      fork: { kind: "all" },
      strategy: "raw",
      parentSession: "/tmp/parent.jsonl",
      source: {
        header: parentHeader,
        entries: [customEntry("startup", null), userEntry("u1", "startup", "one")],
      },
    });

    assert.equal(Result.isOk(result), true);
    if (Result.isError(result)) assert.fail(result.error.message);
    assert.equal(result.value.mode, "raw");
    assert.equal(result.value.warning, undefined);
    assert.equal(typeof result.value.sourceFile, "string");
    if (!result.value.sourceFile) assert.fail("Expected source file");

    const file = await readJsonl(result.value.sourceFile);
    assert.equal(file.header.id, "fork-1");
    assert.equal(file.header.id === parentHeader.id, false);
    assert.equal(file.header.parentSession, "/tmp/parent.jsonl");
    assert.deepEqual(
      file.entries.map((entry) => entry.id),
      ["startup", "u1"],
    );
    assert.deepEqual(
      file.entries.map((entry) => entry.parentId),
      [null, "startup"],
    );
  });
});

void test("Forker turns an empty selected fork slice into fresh mode without warning", async () => {
  await withForker(async ({ forker }) => {
    const result = await forker.create({
      cwd: "/tmp/repo",
      fork: { kind: "last", turns: 1 },
      strategy: "branch",
      source: { header: parentHeader, entries: [customEntry("startup", null)] },
    });

    assert.equal(Result.isOk(result), true);
    if (Result.isError(result)) assert.fail(result.error.message);
    assert.equal(result.value.mode, "fresh");
    assert.equal(result.value.sourceFile, undefined);
    assert.equal(result.value.warning, undefined);
  });
});

void test("Forker falls back to raw fork with warning when branch summary fails", async () => {
  await withForker(
    async ({ forker }) => {
      const result = await forker.create({
        cwd: "/tmp/repo",
        fork: { kind: "all" },
        strategy: "branch",
        source: { header: parentHeader, entries: [userEntry("u1", null, "one")] },
        model,
        modelRegistry: modelRegistry({ apiKey: "test-key" }),
      });

      assert.equal(Result.isOk(result), true);
      if (Result.isError(result)) assert.fail(result.error.message);
      assert.equal(result.value.mode, "raw");
      assert.equal(result.value.warning?.strategy, "branch");
      assert.equal(result.value.warning?.fallback, "raw");
      assert.match(result.value.warning?.message ?? "", /branch exploded/);
      assert.equal(typeof result.value.sourceFile, "string");
    },
    {
      branchSummary: async () => Result.err(new Error("branch exploded")),
    },
  );
});

void test("Forker compact uses hook replacement result against the selected fork slice", async () => {
  await withForker(async ({ forker }) => {
    const observed: ForkerBeforeCompactInput[] = [];
    const entries = [
      userEntry("u1", null, "one"),
      assistantEntry("a1", "u1", "answer"),
      userEntry("u2", "a1", "two"),
      assistantEntry("a2", "u2", "answer two"),
    ];
    const result = await forker.create({
      cwd: "/tmp/repo",
      fork: { kind: "last", turns: 1 },
      strategy: "compact",
      source: { header: parentHeader, entries },
      hooks: {
        beforeCompact(input) {
          observed.push(input);
          return Promise.resolve(
            Result.ok({
              kind: "replace",
              fromExtension: true,
              compaction: {
                summary: "native compact summary",
                firstKeptEntryId: "a2",
                tokensBefore: 456,
                details: { native: true },
              },
            }),
          );
        },
      },
    });

    assert.equal(Result.isOk(result), true);
    if (Result.isError(result)) assert.fail(result.error.message);
    assert.equal(result.value.mode, "compact");
    assert.equal(result.value.warning, undefined);
    assert.equal(observed.length, 1);
    assert.deepEqual(
      observed[0]?.branchEntries.map((entry) => entry.id),
      ["u2", "a2"],
    );
    assert.deepEqual(
      observed[0]?.sessionManager.getBranch().map((entry) => entry.id),
      ["u2", "a2"],
    );
    assert.equal(typeof result.value.sourceFile, "string");
    if (!result.value.sourceFile) assert.fail("Expected source file");

    const file = await readJsonl(result.value.sourceFile);
    assert.equal(file.header.id, "fork-2");
    assert.deepEqual(
      file.entries.map((entry) => entry.id),
      ["fork-1", "a2"],
    );
    assert.deepEqual(file.entries[0], {
      type: "compaction",
      id: "fork-1",
      parentId: null,
      timestamp,
      summary: "native compact summary",
      firstKeptEntryId: "a2",
      tokensBefore: 456,
      details: { native: true },
      fromHook: true,
    });
  });
});

void test("Forker compact uses injected built-in compaction when hook continues", async () => {
  const compacted: ForkerCompactInput[] = [];
  await withForker(
    async ({ forker }) => {
      const result = await forker.create({
        cwd: "/tmp/repo",
        fork: { kind: "all" },
        strategy: "compact",
        source: {
          header: parentHeader,
          entries: [
            userEntry("u1", null, "one"),
            assistantEntry("a1", "u1", "answer"),
            userEntry("u2", "a1", "two"),
            assistantEntry("a2", "u2", "answer two"),
          ],
        },
        model,
        modelRegistry: modelRegistry({ apiKey: "test-key" }),
        hooks: {
          beforeCompact() {
            return Promise.resolve(Result.ok({ kind: "continue" }));
          },
        },
      });

      assert.equal(Result.isOk(result), true);
      if (Result.isError(result)) assert.fail(result.error.message);
      assert.equal(result.value.mode, "compact");
      assert.equal(compacted.length, 1);
      assert.equal(compacted[0]?.auth.apiKey, "test-key");
      assert.equal(typeof result.value.sourceFile, "string");
      if (!result.value.sourceFile) assert.fail("Expected source file");

      const file = await readJsonl(result.value.sourceFile);
      assert.deepEqual(
        file.entries.map((entry) => entry.id),
        ["fork-1", "u2", "a2"],
      );
      assert.deepEqual(file.entries[0], {
        type: "compaction",
        id: "fork-1",
        parentId: null,
        timestamp,
        summary: "built-in compact summary",
        firstKeptEntryId: "u2",
        tokensBefore: 789,
      });
    },
    {
      compact(input) {
        compacted.push(input);
        return Promise.resolve(
          Result.ok({
            summary: "built-in compact summary",
            firstKeptEntryId: "u2",
            tokensBefore: 789,
          }),
        );
      },
    },
  );
});

void test("Forker compact hook error falls back to raw and leaves parent entries unchanged", async () => {
  await withForker(async ({ forker }) => {
    const entries = [
      userEntry("u1", null, "one"),
      assistantEntry("a1", "u1", "answer"),
      userEntry("u2", "a1", "two"),
      assistantEntry("a2", "u2", "answer two"),
    ];
    const before = JSON.stringify(entries);
    const result = await forker.create({
      cwd: "/tmp/repo",
      fork: { kind: "last", turns: 1 },
      strategy: "compact",
      source: { header: parentHeader, entries },
      hooks: {
        beforeCompact(input) {
          assert.deepEqual(
            input.sessionManager.getBranch().map((entry) => entry.id),
            ["u2", "a2"],
          );
          return Promise.resolve(Result.err(new Error("hook exploded")));
        },
      },
    });

    assert.equal(Result.isOk(result), true);
    if (Result.isError(result)) assert.fail(result.error.message);
    assert.equal(result.value.mode, "raw");
    assert.equal(result.value.warning?.strategy, "compact");
    assert.match(result.value.warning?.message ?? "", /hook exploded/);
    assert.equal(JSON.stringify(entries), before);
  });
});

void test("Forker compact hook cancel falls back to raw with warning", async () => {
  await withForker(async ({ forker }) => {
    const result = await forker.create({
      cwd: "/tmp/repo",
      fork: { kind: "all" },
      strategy: "compact",
      source: {
        header: parentHeader,
        entries: [
          userEntry("u1", null, "one"),
          assistantEntry("a1", "u1", "answer"),
          userEntry("u2", "a1", "two"),
          assistantEntry("a2", "u2", "answer two"),
        ],
      },
      hooks: {
        beforeCompact() {
          return Promise.resolve(Result.ok({ kind: "cancel", message: "hook cancelled" }));
        },
      },
    });

    assert.equal(Result.isOk(result), true);
    if (Result.isError(result)) assert.fail(result.error.message);
    assert.equal(result.value.mode, "raw");
    assert.equal(result.value.warning?.strategy, "compact");
    assert.match(result.value.warning?.message ?? "", /hook cancelled/);
  });
});

void test("createPiCompact invokes a real Pi session_before_compact extension hook", async () => {
  const dataHome = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-forker-pi-data-"));
  const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-forker-pi-agent-"));
  const observed: string[] = [];
  const hookBranchIds: string[] = [];
  const extension: ExtensionFactory = (pi) => {
    pi.on("session_start", () => {
      observed.push("session_start");
    });
    pi.on("session_before_compact", (event, ctx) => {
      observed.push("session_before_compact");
      hookBranchIds.push(...ctx.sessionManager.getBranch().map((entry) => entry.id));
      return {
        compaction: {
          summary: "real extension compact",
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
          details: { marker: "real-pi-hook" },
        },
      };
    });
    pi.on("session_compact", (event) => {
      observed.push(event.fromExtension ? "session_compact_hook" : "session_compact_pi");
    });
  };

  try {
    const hookModel = {
      id: "gpt-4.1",
      name: "GPT 4.1",
      api: "openai",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      reasoning: false,
      input: ["text"],
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 200000,
      maxTokens: 20000,
    } satisfies Model<Api>;
    const registry = ModelRegistry.inMemory(
      AuthStorage.inMemory({ openai: { type: "api_key", key: "test-key" } }),
    );
    const ids = ["compact-entry", "fork-session"];
    const forker = new Forker({
      dataHome,
      now: () => timestamp,
      createId: () => ids.shift() ?? "fallback-id",
      compact: createPiCompact({
        dataHome,
        agentDir,
        noExtensions: true,
        extensionFactories: [extension],
      }),
    });
    const entries = [
      userEntry("u1", null, "one"),
      assistantEntry("a1", "u1", "answer"),
      userEntry("u2", "a1", "two"),
      assistantEntry("a2", "u2", "answer two"),
    ];
    const result = await forker.create({
      cwd: dataHome,
      fork: { kind: "all" },
      strategy: "compact",
      source: { header: { ...parentHeader, cwd: dataHome }, entries },
      model: hookModel,
      modelRegistry: registry,
      piModelRegistry: registry,
    });

    assert.equal(Result.isOk(result), true);
    if (Result.isError(result)) assert.fail(result.error.message);
    if (result.value.mode !== "compact") {
      assert.fail(
        `${result.value.warning?.message ?? "Expected compact mode"}; observed=${observed.join(",")}`,
      );
    }
    assert.equal(result.value.mode, "compact");
    assert.deepEqual(observed, ["session_start", "session_before_compact", "session_compact_hook"]);
    assert.equal(hookBranchIds.includes("u1"), true);
    assert.equal(hookBranchIds.includes("a1"), true);
    assert.equal(hookBranchIds.includes("u2"), true);
    assert.equal(hookBranchIds.includes("a2"), true);
    assert.equal(typeof result.value.sourceFile, "string");
    if (!result.value.sourceFile) assert.fail("Expected source file");

    const file = await readJsonl(result.value.sourceFile);
    const compaction = file.entries[0];
    if (compaction?.type !== "compaction") assert.fail("Expected compaction entry");
    assert.equal(compaction.id, "compact-entry");
    assert.equal(compaction.parentId, null);
    assert.equal(compaction.timestamp, timestamp);
    assert.equal(compaction.summary, "real extension compact");
    assert.equal(compaction.firstKeptEntryId, "u1");
    assert.equal(typeof compaction.tokensBefore, "number");
    assert.deepEqual(compaction.details, { marker: "real-pi-hook" });
    assert.equal(compaction.fromHook, true);
  } finally {
    await fs.rm(dataHome, { recursive: true, force: true });
    await fs.rm(agentDir, { recursive: true, force: true });
  }
});

interface ForkerTestDeps {
  readonly branchSummary?: ForkerInput["branchSummary"];
  readonly compact?: ForkerInput["compact"];
}

async function withForker(
  run: (input: { readonly forker: Forker; readonly dataHome: string }) => Promise<void>,
  deps: ForkerTestDeps = {},
): Promise<void> {
  const dataHome = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-forker-"));
  const ids = ["fork-1", "fork-2", "fork-3", "fork-4"];
  const forker = new Forker({
    dataHome,
    now: () => timestamp,
    createId: () => ids.shift() ?? "fallback-id",
    branchSummary:
      deps.branchSummary ??
      (async () => Result.ok({ summary: "branch summary", readFiles: [], modifiedFiles: [] })),
    compact: deps.compact,
  });

  try {
    await run({ forker, dataHome });
  } finally {
    await fs.rm(dataHome, { recursive: true, force: true });
  }
}

function modelRegistry(input: { readonly apiKey: string }): ForkerModelRegistry {
  return {
    getApiKeyAndHeaders() {
      return Promise.resolve({ ok: true, apiKey: input.apiKey } satisfies ForkerAuthResult);
    },
  };
}

async function readJsonl(
  file: string,
): Promise<{ readonly header: SessionHeader; readonly entries: readonly SessionEntry[] }> {
  const lines = (await fs.readFile(file, "utf8")).trim().split("\n");
  const parsed = lines.map((line) => JSON.parse(line) as unknown);
  const header = parsed[0];
  if (!isSessionHeader(header)) assert.fail("Expected session header");
  const entries = parsed.slice(1).filter(isSessionEntry);
  assert.equal(entries.length, parsed.length - 1);
  return { header, entries };
}

function isSessionHeader(value: unknown): value is SessionHeader {
  return Value.Check(SessionHeaderCandidateSchema, value);
}

function isSessionEntry(value: unknown): value is SessionEntry {
  return Value.Check(SessionEntryCandidateSchema, value);
}

function userEntry(id: string, parentId: string | null, content: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "user",
      content: [{ type: "text", text: content }],
      timestamp: 1,
    },
  };
}

function assistantEntry(id: string, parentId: string | null, content: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "assistant",
      content: [{ type: "text", text: content }],
      api: "external-main-provider",
      provider: "external-main-provider",
      model: "main-model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: "stop",
      timestamp: 1,
    },
  };
}

function customEntry(id: string, parentId: string | null): SessionEntry {
  return {
    type: "custom",
    id,
    parentId,
    timestamp,
    customType: "test",
  };
}
