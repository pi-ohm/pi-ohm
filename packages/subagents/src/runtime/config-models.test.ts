import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadOhmRuntimeConfig } from "@pi-ohm/config";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

function withTempDir(run: (dir: string) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "pi-ohm-subagent-model-config-"));
  const result = run(dir);

  return Promise.resolve(result).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}

defineTest("loadOhmRuntimeConfig parses subagents.<id>.model overrides", async () => {
  await withTempDir(async (cwd) => {
    const configDir = join(cwd, ".pi-global");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(join(cwd, ".pi"), { recursive: true });

    writeFileSync(
      join(cwd, ".pi", "ohm.json"),
      JSON.stringify({
        subagents: {
          finder: { model: "OpenAI/gpt-4o" },
          oracle: { model: "anthropic/claude-sonnet-4-5" },
        },
      }),
      "utf8",
    );

    const previousPiConfigDir = process.env.PI_CONFIG_DIR;
    process.env.PI_CONFIG_DIR = configDir;

    try {
      const loaded = await loadOhmRuntimeConfig(cwd);
      assert.equal(loaded.config.subagents?.profiles.finder?.model, "openai/gpt-4o");
      assert.equal(loaded.config.subagents?.profiles.oracle?.model, "anthropic/claude-sonnet-4-5");
    } finally {
      if (previousPiConfigDir === undefined) {
        delete process.env.PI_CONFIG_DIR;
      } else {
        process.env.PI_CONFIG_DIR = previousPiConfigDir;
      }
    }
  });
});

defineTest("loadOhmRuntimeConfig ignores invalid subagent model overrides", async () => {
  await withTempDir(async (cwd) => {
    const configDir = join(cwd, ".pi-global");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(join(cwd, ".pi"), { recursive: true });

    writeFileSync(
      join(cwd, ".pi", "ohm.json"),
      JSON.stringify({
        subagents: {
          finder: { model: "gpt-4o" },
        },
      }),
      "utf8",
    );

    const previousPiConfigDir = process.env.PI_CONFIG_DIR;
    process.env.PI_CONFIG_DIR = configDir;

    try {
      const loaded = await loadOhmRuntimeConfig(cwd);
      assert.equal(loaded.config.subagents?.profiles.finder, undefined);
    } finally {
      if (previousPiConfigDir === undefined) {
        delete process.env.PI_CONFIG_DIR;
      } else {
        process.env.PI_CONFIG_DIR = previousPiConfigDir;
      }
    }
  });
});
