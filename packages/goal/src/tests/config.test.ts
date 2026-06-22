import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Result } from "better-result";
import { Value } from "typebox/value";
import { DEFAULT_GOAL_CONFIG, GoalConfigSchema, loadGoalConfig } from "../config";

function restoreEnv(
  name: "PI_CONFIG_DIR" | "PI_CODING_AGENT_DIR" | "PI_AGENT_DIR",
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function withConfig<T>(run: (input: { readonly cwd: string }) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-goal-config-"));
  const cwd = path.join(dir, "repo");
  const agent = path.join(dir, "agent");
  await fs.mkdir(path.join(cwd, ".pi"), { recursive: true });
  await fs.mkdir(agent, { recursive: true });

  const previousConfig = process.env.PI_CONFIG_DIR;
  const previousCoding = process.env.PI_CODING_AGENT_DIR;
  const previousAgent = process.env.PI_AGENT_DIR;
  process.env.PI_CONFIG_DIR = agent;
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_AGENT_DIR;

  return run({ cwd }).finally(async () => {
    restoreEnv("PI_CONFIG_DIR", previousConfig);
    restoreEnv("PI_CODING_AGENT_DIR", previousCoding);
    restoreEnv("PI_AGENT_DIR", previousAgent);
    await fs.rm(dir, { recursive: true, force: true });
  });
}

void test("GoalConfigSchema accepts experimental managed config only", () => {
  assert.equal(
    Value.Check(GoalConfigSchema, {
      experimental: { managed: { enabled: true } },
    }),
    true,
  );
  assert.equal(Value.Check(GoalConfigSchema, { experimental: { managed: {} } }), true);
  assert.equal(
    Value.Check(GoalConfigSchema, {
      experimental: { managed: { enabled: "yes" } },
    }),
    false,
  );
  assert.equal(
    Value.Check(GoalConfigSchema, {
      experimental: { managed: { enabled: true, mode: "auto" } },
    }),
    false,
  );
  assert.equal(
    Value.Check(GoalConfigSchema, {
      experimental: { managedGoal: { enabled: true } },
    }),
    false,
  );
});

void test("loadGoalConfig resolves experimental managed defaults and project overrides", async () => {
  await withConfig(async ({ cwd }) => {
    const defaults = await loadGoalConfig(cwd);
    assert.equal(Result.isOk(defaults), true);
    if (Result.isError(defaults)) assert.fail(defaults.error.message);
    assert.deepEqual(defaults.value.config.experimental, DEFAULT_GOAL_CONFIG.experimental);
    assert.deepEqual(defaults.value.config.experimental, { managed: { enabled: false } });

    await fs.writeFile(
      path.join(cwd, ".pi", "ohm.json"),
      JSON.stringify({
        goal: {
          defaultTokenBudget: 42,
          experimental: {
            managed: { enabled: true },
          },
        },
      }),
      "utf8",
    );

    const loaded = await loadGoalConfig(cwd);
    assert.equal(Result.isOk(loaded), true);
    if (Result.isError(loaded)) assert.fail(loaded.error.message);
    assert.equal(loaded.value.config.enabled, true);
    assert.equal(loaded.value.config.autoContinue, true);
    assert.equal(loaded.value.config.defaultTokenBudget, 42);
    assert.deepEqual(loaded.value.config.experimental, { managed: { enabled: true } });
  });
});
