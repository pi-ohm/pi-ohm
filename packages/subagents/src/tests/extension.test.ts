import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import registerSubagentsExtension, { runSubagentsCommand } from "../extension";

void test("registerSubagentsExtension registers subagents command", () => {
  const commands: string[] = [];

  registerSubagentsExtension({
    appendEntry() {},
    getThinkingLevel(): "medium" {
      return "medium";
    },
    on() {},
    registerCommand(name) {
      commands.push(name);
    },
    registerTool() {},
  });

  assert.equal(commands.includes("subagents"), true);
});

void test("runSubagentsCommand mounts a non-model-facing pi-tui widget", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-subagents-command-"));
  const cwd = path.join(dir, "repo");
  const agent = path.join(dir, "agent");
  await fs.mkdir(path.join(cwd, ".pi"), { recursive: true });
  await fs.mkdir(agent, { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".pi", "ohm.json"),
    JSON.stringify({
      subagents: {
        reviewer: {
          description: "Custom reviewer",
          tools: ["read"],
        },
      },
    }),
    "utf8",
  );

  const previousConfig = process.env.PI_CONFIG_DIR;
  process.env.PI_CONFIG_DIR = agent;
  let widgetFactory: ((...args: readonly unknown[]) => unknown) | undefined;
  const statuses: string[] = [];

  try {
    await runSubagentsCommand(
      {
        cwd,
        hasUI: true,
        model: { provider: "external-main", id: "main-model" },
        ui: {
          setWidget(_key, content) {
            widgetFactory = content;
          },
          setStatus(_key, text) {
            if (text) statuses.push(text);
          },
        },
      },
      {
        getThinkingLevel(): "high" {
          return "high";
        },
      },
    );
  } finally {
    if (previousConfig === undefined) delete process.env.PI_CONFIG_DIR;
    if (previousConfig !== undefined) process.env.PI_CONFIG_DIR = previousConfig;
    await fs.rm(dir, { recursive: true, force: true });
  }

  assert.notEqual(widgetFactory, undefined);
  assert.equal(statuses.includes("subagents 4"), true);
  const widget = widgetFactory?.();
  assert.equal(typeof widget, "object");
  if (!widget || typeof widget !== "object") assert.fail("Expected widget component");
  const render = Reflect.get(widget, "render");
  assert.equal(typeof render, "function");
});
