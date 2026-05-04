import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MEMORIES_CONFIG, mergeMemoriesConfig } from "../config";

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
