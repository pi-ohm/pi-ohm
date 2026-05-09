import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface RegisteredToolDefinition {
  readonly name: string;
  readonly execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    context: {
      readonly cwd: string;
      readonly hasUI: boolean;
      readonly ui?: unknown;
    },
  ) => Promise<unknown>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRegisteredToolDefinition(value: unknown): value is RegisteredToolDefinition {
  if (!isObjectRecord(value)) return false;
  const name = Reflect.get(value, "name");
  const execute = Reflect.get(value, "execute");
  return typeof name === "string" && typeof execute === "function";
}

function resolveRegisterSubagentTools(
  module: unknown,
): (pi: Pick<ExtensionAPI, "registerTool">) => unknown {
  if (!isObjectRecord(module)) {
    throw new Error("Invalid dist module export shape");
  }

  const registerSubagentTools = Reflect.get(module, "registerSubagentTools");
  if (typeof registerSubagentTools !== "function") {
    throw new Error("registerSubagentTools export missing from dist bundle");
  }

  return (pi) => registerSubagentTools(pi);
}

function resolveToolDefinition(
  definitions: Map<string, unknown>,
  name: string,
): RegisteredToolDefinition {
  const candidate = definitions.get(name);
  if (!isRegisteredToolDefinition(candidate)) {
    throw new Error(`Registered tool '${name}' missing execute contract`);
  }

  return candidate;
}

function extractToolText(result: unknown): string {
  if (!isObjectRecord(result)) {
    throw new Error("Tool result is not an object");
  }

  const content = Reflect.get(result, "content");
  if (!Array.isArray(content)) {
    throw new Error("Tool result content block missing");
  }

  for (const part of content) {
    if (!isObjectRecord(part)) continue;
    if (Reflect.get(part, "type") !== "text") continue;
    const text = Reflect.get(part, "text");
    if (typeof text === "string") return text;
  }

  throw new Error("Tool result text block missing");
}

function extractToolDetails(result: unknown): Record<string, unknown> {
  if (!isObjectRecord(result)) {
    throw new Error("Tool result is not an object");
  }

  const details = Reflect.get(result, "details");
  if (!isObjectRecord(details)) {
    throw new Error("Tool result details block missing");
  }

  return details;
}

function buildLineRange(start: number, end: number): string {
  return Array.from({ length: end - start + 1 }, (_unused, index) => {
    const value = start + index;
    return `LINE ${String(value).padStart(3, "0")}`;
  }).join("\n");
}

function assertTransportTelemetry(details: Record<string, unknown>, text: string): void {
  const resultCharsToAgent = Reflect.get(details, "result_chars_to_agent");
  const resultCharsTotal = Reflect.get(details, "result_chars_total");
  const resultCharsToUi = Reflect.get(details, "result_chars_to_ui");
  const uiTruncated = Reflect.get(details, "ui_truncated");

  assert.equal(resultCharsToAgent, text.length);
  assert.equal(resultCharsTotal, text.length);
  assert.equal(typeof resultCharsToUi, "number");
  assert.equal(typeof uiTruncated, "boolean");

  if (typeof resultCharsToUi !== "number") {
    assert.fail("result_chars_to_ui should be numeric");
  }

  if (typeof uiTruncated !== "boolean") {
    assert.fail("ui_truncated should be boolean");
  }

  assert.equal(uiTruncated, resultCharsToUi < text.length);
}

const runtimeConfigFixture = {
  defaultMode: "smart",
  subagentBackend: "none",
  features: {
    handoff: true,
    subagents: true,
    sessionThreadSearch: true,
    handoffVisualizer: true,
    painterImagegen: false,
  },
  painter: {
    googleNanoBanana: {
      enabled: false,
      model: "",
    },
    openai: {
      enabled: false,
      model: "",
    },
    azureOpenai: {
      enabled: false,
      deployment: "",
      endpoint: "",
      apiVersion: "",
    },
  },
  subagents: {
    taskMaxConcurrency: 2,
    taskRetentionMs: 60_000,
    permissions: {
      default: "allow",
      subagents: {},
      allowInternalRouting: false,
    },
    profiles: {},
  },
} as const;

void test("compiled dist transport keeps full payload and source tagging for task + primary routes", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const distPath = path.join(repoRoot, "packages/subagents/dist/extension.js");
  const distSource = await readFile(distPath, "utf8");

  assert.match(distSource, /result_source/);
  assert.match(distSource, /task transport invariant violated/);

  const workspace = await mkdtemp(path.join(tmpdir(), "pi-ohm-subagents-dist-"));
  const projectPiDir = path.join(workspace, ".pi");
  await mkdir(projectPiDir, { recursive: true });
  await writeFile(path.join(projectPiDir, "ohm.json"), `${JSON.stringify(runtimeConfigFixture)}\n`);

  const previousPersistPath = process.env.OHM_SUBAGENTS_TASK_PERSIST_PATH;
  process.env.OHM_SUBAGENTS_TASK_PERSIST_PATH = path.join(projectPiDir, "ohm.subagents.tasks.json");

  try {
    const module = await import(pathToFileURL(distPath).href);
    const registerSubagentTools = resolveRegisterSubagentTools(module);
    const definitions = new Map<string, unknown>();

    registerSubagentTools({
      registerTool: (definition) => {
        definitions.set(definition.name, definition);
      },
    });

    const taskTool = resolveToolDefinition(definitions, "task");
    const librarianTool = resolveToolDefinition(definitions, "librarian");

    const taskShort = await taskTool.execute(
      "dist_task_short",
      {
        op: "start",
        subagent_type: "finder",
        description: "dist short output",
        prompt: "SHORT OUTPUT",
      },
      undefined,
      undefined,
      {
        cwd: workspace,
        hasUI: false,
      },
    );

    const taskShortText = extractToolText(taskShort);
    const taskShortDetails = extractToolDetails(taskShort);
    assert.equal(Reflect.get(taskShortDetails, "result_source"), "output");
    assert.match(taskShortText, /SHORT OUTPUT/);
    assertTransportTelemetry(taskShortDetails, taskShortText);

    const longPrompt = buildLineRange(1, 220);
    const taskLong = await taskTool.execute(
      "dist_task_long",
      {
        op: "start",
        subagent_type: "finder",
        description: "dist long output",
        prompt: longPrompt,
      },
      undefined,
      undefined,
      {
        cwd: workspace,
        hasUI: false,
      },
    );

    const taskLongText = extractToolText(taskLong);
    const taskLongDetails = extractToolDetails(taskLong);
    assert.equal(Reflect.get(taskLongDetails, "result_source"), "output");
    assert.match(taskLongText, /LINE 001/);
    assert.match(taskLongText, /LINE 220/);
    assertTransportTelemetry(taskLongDetails, taskLongText);

    const primaryShort = await librarianTool.execute(
      "dist_primary_short",
      {
        query: "PRIMARY SHORT OUTPUT",
      },
      undefined,
      undefined,
      {
        cwd: workspace,
        hasUI: false,
      },
    );

    const primaryShortText = extractToolText(primaryShort);
    const primaryShortDetails = extractToolDetails(primaryShort);
    assert.equal(Reflect.get(primaryShortDetails, "result_source"), "output");
    assert.match(primaryShortText, /PRIMARY SHORT OUTPUT/);
    assertTransportTelemetry(primaryShortDetails, primaryShortText);

    const primaryLong = await librarianTool.execute(
      "dist_primary_long",
      {
        query: longPrompt,
      },
      undefined,
      undefined,
      {
        cwd: workspace,
        hasUI: false,
      },
    );

    const primaryLongText = extractToolText(primaryLong);
    const primaryLongDetails = extractToolDetails(primaryLong);
    assert.equal(Reflect.get(primaryLongDetails, "result_source"), "output");
    assert.match(primaryLongText, /LINE 001/);
    assert.match(primaryLongText, /LINE 220/);
    assertTransportTelemetry(primaryLongDetails, primaryLongText);
  } finally {
    if (previousPersistPath === undefined) {
      delete process.env.OHM_SUBAGENTS_TASK_PERSIST_PATH;
    } else {
      process.env.OHM_SUBAGENTS_TASK_PERSIST_PATH = previousPersistPath;
    }
  }
});
