import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_SUBAGENT_PROMPT_PROFILE_RULES,
  resolveSubagentPromptProfileSelection,
} from "../system-prompts";
import {
  loadSubagentPromptProfileRules,
  resetSubagentPromptProfileRulesCache,
} from "../prompt-profile-rules";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

function withTempDir(run: (dir: string) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-ohm-prompt-profile-rules-"));
  const result = run(dir);
  return Promise.resolve(result).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}

function writeProvidersConfig(configDir: string, payload: unknown): string {
  mkdirSync(configDir, { recursive: true });
  const filePath = path.join(configDir, "ohm.providers.json");
  writeFileSync(filePath, JSON.stringify(payload), "utf8");
  return filePath;
}

async function withIsolatedConfigEnv<T>(configDir: string, run: () => Promise<T>): Promise<T> {
  const priorConfigDir = process.env.PI_CONFIG_DIR;
  const priorCodingAgentDir = process.env.PI_CODING_AGENT_DIR;
  const priorPiAgentDir = process.env.PI_AGENT_DIR;

  process.env.PI_CONFIG_DIR = configDir;
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_AGENT_DIR;

  try {
    return await run();
  } finally {
    if (priorConfigDir === undefined) {
      delete process.env.PI_CONFIG_DIR;
    } else {
      process.env.PI_CONFIG_DIR = priorConfigDir;
    }

    if (priorCodingAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = priorCodingAgentDir;
    }

    if (priorPiAgentDir === undefined) {
      delete process.env.PI_AGENT_DIR;
    } else {
      process.env.PI_AGENT_DIR = priorPiAgentDir;
    }
  }
}

defineTest(
  "loadSubagentPromptProfileRules falls back to defaults when providers config is missing",
  async () => {
    await withTempDir(async (cwd) => {
      resetSubagentPromptProfileRulesCache();
      const configDir = path.join(cwd, ".pi-global");

      await withIsolatedConfigEnv(configDir, async () => {
        const loaded = await loadSubagentPromptProfileRules(cwd);
        assert.equal(loaded.sourcePath, undefined);
        assert.deepEqual(
          loaded.rules.map((rule) => rule.profile),
          DEFAULT_SUBAGENT_PROMPT_PROFILE_RULES.map((rule) => rule.profile),
        );
        assert.deepEqual(loaded.diagnostics, []);
      });
    });
  },
);

defineTest("loadSubagentPromptProfileRules parses typed prompt profile rules", async () => {
  await withTempDir(async (cwd) => {
    resetSubagentPromptProfileRulesCache();
    const configDir = path.join(cwd, ".pi-global");
    const providersPath = writeProvidersConfig(configDir, {
      subagents: {
        promptProfiles: {
          rules: [
            {
              profile: "moonshot",
              priority: 500,
              match: {
                providers: ["router-x"],
                models: ["kimi-custom"],
              },
              metadata: {
                label: "router moonshot rule",
              },
            },
          ],
        },
      },
    });

    await withIsolatedConfigEnv(configDir, async () => {
      const loaded = await loadSubagentPromptProfileRules(cwd);
      assert.equal(loaded.sourcePath, providersPath);
      assert.equal(loaded.rules.length, 1);
      assert.equal(loaded.rules[0]?.profile, "moonshot");
      assert.equal(loaded.rules[0]?.priority, 500);
      assert.equal(loaded.rules[0]?.metadata?.label, "router moonshot rule");
      assert.deepEqual(loaded.diagnostics, []);
    });
  });
});

defineTest(
  "loadSubagentPromptProfileRules fails soft on invalid rules and emits diagnostics",
  async () => {
    await withTempDir(async (cwd) => {
      resetSubagentPromptProfileRulesCache();
      const configDir = path.join(cwd, ".pi-global");
      writeProvidersConfig(configDir, {
        subagents: {
          promptProfiles: {
            rules: [
              {
                profile: "unknown-profile",
                match: { providers: ["router-x"], models: [] },
              },
            ],
          },
        },
      });

      await withIsolatedConfigEnv(configDir, async () => {
        const loaded = await loadSubagentPromptProfileRules(cwd);
        assert.deepEqual(
          loaded.rules.map((rule) => rule.profile),
          DEFAULT_SUBAGENT_PROMPT_PROFILE_RULES.map((rule) => rule.profile),
        );
        assert.equal(
          loaded.diagnostics.some((entry) => entry.includes("invalid profile")),
          true,
        );
        assert.equal(
          loaded.diagnostics.some((entry) => entry.includes("using defaults")),
          true,
        );
      });
    });
  },
);

defineTest(
  "loadSubagentPromptProfileRules fails soft on invalid json and emits diagnostics",
  async () => {
    await withTempDir(async (cwd) => {
      resetSubagentPromptProfileRulesCache();
      const configDir = path.join(cwd, ".pi-global");
      mkdirSync(configDir, { recursive: true });
      const providersPath = path.join(configDir, "ohm.providers.json");
      writeFileSync(providersPath, "{ invalid-json", "utf8");

      await withIsolatedConfigEnv(configDir, async () => {
        const loaded = await loadSubagentPromptProfileRules(cwd);
        assert.deepEqual(
          loaded.rules.map((rule) => rule.profile),
          DEFAULT_SUBAGENT_PROMPT_PROFILE_RULES.map((rule) => rule.profile),
        );
        assert.equal(loaded.sourcePath, providersPath);
        assert.equal(loaded.diagnostics.length >= 1, true);
      });
    });
  },
);

defineTest(
  "prompt profile mapping changes after config edit without code changes (demo)",
  async () => {
    await withTempDir(async (cwd) => {
      resetSubagentPromptProfileRulesCache();
      const configDir = path.join(cwd, ".pi-global");
      const providersPath = writeProvidersConfig(configDir, {
        subagents: {
          promptProfiles: {
            rules: [
              {
                profile: "moonshot",
                priority: 500,
                match: { providers: ["router-x"], models: [] },
              },
            ],
          },
        },
      });

      await withIsolatedConfigEnv(configDir, async () => {
        const first = await loadSubagentPromptProfileRules(cwd);
        const firstSelection = resolveSubagentPromptProfileSelection({
          provider: "router-x",
          modelId: "custom-model",
          profileRules: first.rules,
        });
        assert.equal(firstSelection.profile, "moonshot");

        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        writeProvidersConfig(configDir, {
          subagents: {
            promptProfiles: {
              rules: [
                {
                  profile: "google",
                  priority: 500,
                  match: { providers: ["router-x"], models: [] },
                },
              ],
            },
          },
        });

        const second = await loadSubagentPromptProfileRules(cwd);
        assert.equal(second.sourcePath, providersPath);
        const secondSelection = resolveSubagentPromptProfileSelection({
          provider: "router-x",
          modelId: "custom-model",
          profileRules: second.rules,
        });
        assert.equal(secondSelection.profile, "google");
      });
    });
  },
);
