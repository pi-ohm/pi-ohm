import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadOhmRuntimeConfig, resolveSubagentProfileRuntimeConfig } from "@pi-ohm/config";

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

defineTest(
  "loadOhmRuntimeConfig preserves optional :thinking suffix in subagent model overrides",
  async () => {
    await withTempDir(async (cwd) => {
      const configDir = join(cwd, ".pi-global");
      mkdirSync(configDir, { recursive: true });
      mkdirSync(join(cwd, ".pi"), { recursive: true });

      writeFileSync(
        join(cwd, ".pi", "ohm.json"),
        JSON.stringify({
          subagents: {
            finder: { model: "openai/gpt-5:high" },
          },
        }),
        "utf8",
      );

      const previousPiConfigDir = process.env.PI_CONFIG_DIR;
      process.env.PI_CONFIG_DIR = configDir;

      try {
        const loaded = await loadOhmRuntimeConfig(cwd);
        assert.equal(loaded.config.subagents?.profiles.finder?.model, "openai/gpt-5:high");
      } finally {
        if (previousPiConfigDir === undefined) {
          delete process.env.PI_CONFIG_DIR;
        }
        if (previousPiConfigDir !== undefined) {
          process.env.PI_CONFIG_DIR = previousPiConfigDir;
        }
      }
    });
  },
);

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

defineTest("loadOhmRuntimeConfig parses subagent prompt metadata + wildcard variants", async () => {
  await withTempDir(async (cwd) => {
    const configDir = join(cwd, ".pi-global");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(join(cwd, ".pi"), { recursive: true });

    writeFileSync(
      join(cwd, ".pi", "ohm.json"),
      JSON.stringify({
        subagents: {
          "my-custom-agent": {
            prompt: "{file:./prompts/my-custom-agent.general.txt}",
            description: "General custom helper",
            whenToUse: ["General delegation"],
            permissions: {
              bash: "allow",
              edit: "deny",
            },
            variants: {
              "*gemini*": {
                prompt: "{file:./prompts/my-custom-agent.gemini.txt}",
                model: "github-copilot/gemini-3.1-pro-preview:high",
                description: "Gemini tuned helper",
                whenToUse: ["Gemini model flow"],
                permissions: {
                  edit: "inherit",
                  apply_patch: "deny",
                },
              },
            },
          },
        },
      }),
      "utf8",
    );

    const previousPiConfigDir = process.env.PI_CONFIG_DIR;
    process.env.PI_CONFIG_DIR = configDir;

    try {
      const loaded = await loadOhmRuntimeConfig(cwd);
      const resolved = resolveSubagentProfileRuntimeConfig({
        config: loaded.config,
        subagentId: "my-custom-agent",
        modelPattern: "google/gemini-3-flash-preview",
      });

      assert.equal(resolved?.variantPattern, "*gemini*");
      assert.equal(resolved?.model, "github-copilot/gemini-3.1-pro-preview:high");
      assert.equal(resolved?.prompt, "{file:./prompts/my-custom-agent.gemini.txt}");
      assert.equal(resolved?.description, "Gemini tuned helper");
      assert.deepEqual(resolved?.whenToUse, ["Gemini model flow"]);
      assert.deepEqual(resolved?.permissions, {
        bash: "allow",
        edit: "deny",
        apply_patch: "deny",
      });
    } finally {
      if (previousPiConfigDir === undefined) {
        delete process.env.PI_CONFIG_DIR;
      } else {
        process.env.PI_CONFIG_DIR = previousPiConfigDir;
      }
    }
  });
});

defineTest(
  "resolveSubagentProfileRuntimeConfig prefers project variants over global wildcard matches",
  async () => {
    await withTempDir(async (cwd) => {
      const configDir = join(cwd, ".pi-global");
      mkdirSync(configDir, { recursive: true });
      mkdirSync(join(cwd, ".pi"), { recursive: true });

      writeFileSync(
        join(configDir, "ohm.json"),
        JSON.stringify({
          subagents: {
            finder: {
              variants: {
                "*gpt*": {
                  prompt: "global wildcard",
                },
              },
            },
          },
        }),
        "utf8",
      );

      writeFileSync(
        join(cwd, ".pi", "ohm.json"),
        JSON.stringify({
          subagents: {
            finder: {
              variants: {
                "openai/gpt-5*": {
                  prompt: "project gpt5 override",
                },
              },
            },
          },
        }),
        "utf8",
      );

      const previousPiConfigDir = process.env.PI_CONFIG_DIR;
      process.env.PI_CONFIG_DIR = configDir;

      try {
        const loaded = await loadOhmRuntimeConfig(cwd);
        const resolved = resolveSubagentProfileRuntimeConfig({
          config: loaded.config,
          subagentId: "finder",
          modelPattern: "openai/gpt-5",
        });

        assert.equal(resolved?.variantPattern, "openai/gpt-5*");
        assert.equal(resolved?.prompt, "project gpt5 override");
      } finally {
        if (previousPiConfigDir === undefined) {
          delete process.env.PI_CONFIG_DIR;
        } else {
          process.env.PI_CONFIG_DIR = previousPiConfigDir;
        }
      }
    });
  },
);
