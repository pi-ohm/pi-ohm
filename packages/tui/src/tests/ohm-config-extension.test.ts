import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Result } from "better-result";
import { Type } from "typebox";
import {
  clearGlobalConfigModulesForTesting,
  registerConfig,
  registerGlobalConfigModule,
} from "@pi-ohm/core/config";
import registerOhmConfigExtension, { runOhmConfigCommand } from "../ohm-config-extension";

const demo = registerConfig({
  namespace: "demo",
  schema: Type.Object({ count: Type.Optional(Type.Integer({ minimum: 1 })) }),
  defaults: { count: 1 },
  merge(base: { readonly count: number }, patch: { readonly count?: number }) {
    return Result.ok({ count: patch.count ?? base.count });
  },
});

async function withConfig<T>(
  run: (input: { readonly cwd: string; readonly agent: string }) => Promise<T>,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-tui-config-"));
  const cwd = path.join(dir, "repo");
  const agent = path.join(dir, "agent");
  await fs.mkdir(path.join(cwd, ".pi"), { recursive: true });
  await fs.mkdir(agent, { recursive: true });

  const previous = process.env.PI_CONFIG_DIR;
  process.env.PI_CONFIG_DIR = agent;

  return run({ cwd, agent }).finally(async () => {
    if (previous === undefined) delete process.env.PI_CONFIG_DIR;
    if (previous !== undefined) process.env.PI_CONFIG_DIR = previous;
    clearGlobalConfigModulesForTesting();
    await fs.rm(dir, { recursive: true, force: true });
  });
}

void test("runOhmConfigCommand mounts the registered module config", async () => {
  await withConfig(async ({ cwd }) => {
    await fs.writeFile(
      path.join(cwd, ".pi", "ohm.json"),
      JSON.stringify({ demo: { count: 7 } }),
      "utf8",
    );
    registerGlobalConfigModule(demo);

    let widget: ((...args: readonly unknown[]) => unknown) | undefined;
    const statuses: string[] = [];
    await runOhmConfigCommand({
      cwd,
      hasUI: true,
      sessionManager: { getSessionFile: () => undefined },
      ui: {
        setWidget(_key, content) {
          widget = content;
        },
        setStatus(_key, text) {
          if (text) statuses.push(text);
        },
      },
    });

    assert.equal(typeof widget, "function");
    assert.equal(statuses.includes("ohm:1 config modules"), true);
    const component = widget?.();
    assert.equal(typeof component, "object");
  });
});

void test("registerOhmConfigExtension registers /ohm once", () => {
  clearGlobalConfigModulesForTesting();
  const commands: string[] = [];
  const pi = {
    on() {},
    registerCommand(name: string) {
      commands.push(name);
    },
  };

  registerOhmConfigExtension(pi);
  registerOhmConfigExtension(pi);

  assert.deepEqual(commands, ["ohm"]);
});
