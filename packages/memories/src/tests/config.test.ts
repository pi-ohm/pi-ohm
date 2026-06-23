import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Result } from "better-result";
import { DEFAULT_MEMORIES_CONFIG, loadMemoriesConfig, mergeMemoriesConfig } from "../config";

void test("mergeMemoriesConfig clamps Codex-compatible limits", () => {
  const config = mergeMemoriesConfig(DEFAULT_MEMORIES_CONFIG, {
    maxRawMemoriesForConsolidation: 99999,
    maxUnusedDays: -1,
    maxRolloutAgeDays: 999,
    maxRolloutsPerStartup: 0,
    minRolloutIdleHours: 999,
    minRateLimitRemainingPercent: 999,
  });

  assert.equal(config.maxRawMemoriesForConsolidation, 4096);
  assert.equal(config.maxUnusedDays, 0);
  assert.equal(config.maxRolloutAgeDays, 90);
  assert.equal(config.maxRolloutsPerStartup, 1);
  assert.equal(config.minRolloutIdleHours, 48);
  assert.equal(config.minRateLimitRemainingPercent, 100);
});

void test("loadMemoriesConfig reports invalid config JSON", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-memories-config-"));
  const cwd = path.join(dir, "repo");
  const agent = path.join(dir, "agent");
  await fs.mkdir(path.join(cwd, ".pi"), { recursive: true });
  await fs.mkdir(agent, { recursive: true });
  await fs.writeFile(path.join(cwd, ".pi", "ohm.json"), "{ nope", "utf8");

  const previous = process.env.PI_CONFIG_DIR;
  process.env.PI_CONFIG_DIR = agent;
  const config = await loadMemoriesConfig(cwd).finally(async () => {
    if (previous === undefined) delete process.env.PI_CONFIG_DIR;
    if (previous !== undefined) process.env.PI_CONFIG_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });

  assert.equal(Result.isError(config), true);
  if (Result.isOk(config)) assert.fail("expected invalid JSON to be reported");
  assert.equal(config.error.code, "config_parse_failed");
  assert.equal(config.error.path, path.join(cwd, ".pi", "ohm.json"));
});
