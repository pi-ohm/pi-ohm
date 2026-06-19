import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const UnknownRecordSchema = Type.Record(Type.String(), Type.Unknown());

interface ToolLike {
  readonly name: string;
  readonly description: string;
}

type UnknownFunction = (...args: readonly unknown[]) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Value.Check(UnknownRecordSchema, value);
}

function isToolLike(value: unknown): value is ToolLike {
  if (!isRecord(value)) return false;
  return typeof value.name === "string" && typeof value.description === "string";
}

function isUnknownFunction(value: unknown): value is UnknownFunction {
  return typeof value === "function";
}

function resolveFunction(value: unknown, name: string): UnknownFunction {
  if (!isRecord(value)) throw new Error("Invalid dist module export shape");
  const candidate = Reflect.get(value, name);
  if (!isUnknownFunction(candidate)) throw new Error(`${name} export missing from dist bundle`);
  return candidate;
}

function resolveTools(value: unknown): readonly ToolLike[] {
  if (!Array.isArray(value)) throw new Error("Tool factory did not return an array");
  const tools = value.filter(isToolLike);
  if (tools.length !== value.length) throw new Error("Tool factory returned invalid tool entries");
  return tools;
}

void test("compiled dist exposes the Codex v2 subagent tool surface", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const distPath = path.join(repoRoot, "packages/subagents/dist/extension.js");
  const controllerPath = path.join(repoRoot, "packages/subagents/dist/agent-controller.js");
  const source = await readFile(controllerPath, "utf8");

  assert.match(source, /spawn_agent/);
  assert.match(source, /send_message/);
  assert.match(source, /followup_task/);
  assert.match(source, /wait_agent/);
  assert.match(source, /interrupt_agent/);
  assert.match(source, /list_agents/);
  assert.doesNotMatch(source, /send_agent_input/);
  assert.doesNotMatch(source, /get_agent_result/);

  const module = await import(pathToFileURL(distPath).href);
  const createSubagentToolRuntime = resolveFunction(module, "createSubagentToolRuntime");
  const createSubagentTools = resolveFunction(module, "createSubagentTools");
  const pi = {
    appendEntry(customType: string, data?: unknown) {
      assert.equal(customType.length > 0, true);
      assert.equal(data !== undefined, true);
    },
    getThinkingLevel(): "medium" {
      return "medium";
    },
    sendMessage() {
      return undefined;
    },
  } satisfies Pick<ExtensionAPI, "appendEntry" | "getThinkingLevel" | "sendMessage">;
  const runtime = createSubagentToolRuntime(pi);
  const tools = resolveTools(createSubagentTools(runtime));

  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      "spawn_agent",
      "send_message",
      "followup_task",
      "wait_agent",
      "interrupt_agent",
      "list_agents",
    ],
  );
});
