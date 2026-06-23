import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadPiScopedModelCatalog,
  resetPiScopedModelCatalogCache,
  resolvePiSettingsCandidates,
} from "../model-scope";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

function withTempDir(run: (dir: string) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-ohm-model-scope-"));
  const result = run(dir);
  return Promise.resolve(result).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}

function writeSettingsFile(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload), "utf8");
}

defineTest("resolvePiSettingsCandidates keeps deterministic precedence", () => {
  const cwd = "/tmp/project";
  const priorConfigDir = process.env.PI_CONFIG_DIR;
  const priorCodingAgentDir = process.env.PI_CODING_AGENT_DIR;
  const priorPiAgentDir = process.env.PI_AGENT_DIR;

  process.env.PI_CONFIG_DIR = "/tmp/config-a";
  process.env.PI_CODING_AGENT_DIR = "/tmp/config-b";
  process.env.PI_AGENT_DIR = "/tmp/config-c";

  try {
    const candidates = resolvePiSettingsCandidates(cwd).map((candidate) => candidate.source);
    assert.deepEqual(candidates.slice(0, 4), [
      "project_local",
      "env_pi_config_dir",
      "env_pi_coding_agent_dir",
      "env_pi_agent_dir",
    ]);
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
});

defineTest("loadPiScopedModelCatalog prefers project-local settings over env dir", async () => {
  await withTempDir(async (cwd) => {
    resetPiScopedModelCatalogCache();

    const envDir = path.join(cwd, ".pi-global");
    const projectSettingsPath = path.join(cwd, ".pi", "agent", "settings.json");
    const envSettingsPath = path.join(envDir, "settings.json");

    writeSettingsFile(envSettingsPath, {
      enabledModels: ["openai/gpt-5"],
    });
    writeSettingsFile(projectSettingsPath, {
      enabledModels: ["github-copilot/claude-opus-4.6"],
    });

    const priorConfigDir = process.env.PI_CONFIG_DIR;
    process.env.PI_CONFIG_DIR = envDir;

    try {
      const loaded = await loadPiScopedModelCatalog(cwd);
      assert.equal(loaded.source, "project_local");
      assert.equal(loaded.sourcePath, projectSettingsPath);
      assert.deepEqual(loaded.models, [
        {
          provider: "github-copilot",
          modelId: "claude-opus-4.6",
          pattern: "github-copilot/claude-opus-4.6",
        },
      ]);
    } finally {
      if (priorConfigDir === undefined) {
        delete process.env.PI_CONFIG_DIR;
      } else {
        process.env.PI_CONFIG_DIR = priorConfigDir;
      }
    }
  });
});

defineTest("loadPiScopedModelCatalog skips malformed higher-precedence settings", async () => {
  await withTempDir(async (cwd) => {
    resetPiScopedModelCatalogCache();

    const envDir = path.join(cwd, ".pi-global");
    const projectSettingsPath = path.join(cwd, ".pi", "agent", "settings.json");
    const envSettingsPath = path.join(envDir, "settings.json");

    mkdirSync(path.dirname(projectSettingsPath), { recursive: true });
    writeFileSync(projectSettingsPath, "{ invalid-json", "utf8");
    writeSettingsFile(envSettingsPath, {
      enabledModels: ["openai/gpt-5.3-codex", "openai/gpt-5.3-codex:high"],
    });

    const priorConfigDir = process.env.PI_CONFIG_DIR;
    process.env.PI_CONFIG_DIR = envDir;

    try {
      const loaded = await loadPiScopedModelCatalog(cwd);
      assert.equal(loaded.source, "env_pi_config_dir");
      assert.equal(loaded.sourcePath, envSettingsPath);
      assert.deepEqual(loaded.models, [
        {
          provider: "openai",
          modelId: "gpt-5.3-codex",
          pattern: "openai/gpt-5.3-codex",
        },
      ]);
      assert.equal(
        loaded.diagnostics.some((entry) => entry.includes(projectSettingsPath)),
        true,
      );
    } finally {
      if (priorConfigDir === undefined) {
        delete process.env.PI_CONFIG_DIR;
      } else {
        process.env.PI_CONFIG_DIR = priorConfigDir;
      }
    }
  });
});

defineTest(
  "loadPiScopedModelCatalog refreshes cached parse when settings mtime changes",
  async () => {
    await withTempDir(async (cwd) => {
      resetPiScopedModelCatalogCache();

      const envDir = path.join(cwd, ".pi-global");
      const envSettingsPath = path.join(envDir, "settings.json");
      writeSettingsFile(envSettingsPath, {
        enabledModels: ["openai/gpt-5.3-codex"],
      });

      const priorConfigDir = process.env.PI_CONFIG_DIR;
      process.env.PI_CONFIG_DIR = envDir;

      try {
        const first = await loadPiScopedModelCatalog(cwd);
        assert.deepEqual(first.models, [
          {
            provider: "openai",
            modelId: "gpt-5.3-codex",
            pattern: "openai/gpt-5.3-codex",
          },
        ]);

        await new Promise<void>((resolve) => setTimeout(resolve, 20));

        writeSettingsFile(envSettingsPath, {
          enabledModels: ["github-copilot/gemini-3-pro-preview"],
        });

        const second = await loadPiScopedModelCatalog(cwd);
        assert.deepEqual(second.models, [
          {
            provider: "github-copilot",
            modelId: "gemini-3-pro-preview",
            pattern: "github-copilot/gemini-3-pro-preview",
          },
        ]);
      } finally {
        if (priorConfigDir === undefined) {
          delete process.env.PI_CONFIG_DIR;
        } else {
          process.env.PI_CONFIG_DIR = priorConfigDir;
        }
      }
    });
  },
);

defineTest(
  "loadPiScopedModelCatalog returns empty catalog when no settings files exist",
  async () => {
    await withTempDir(async (cwd) => {
      resetPiScopedModelCatalogCache();

      const priorConfigDir = process.env.PI_CONFIG_DIR;
      const priorCodingAgentDir = process.env.PI_CODING_AGENT_DIR;
      const priorPiAgentDir = process.env.PI_AGENT_DIR;
      const priorHome = process.env.HOME;
      process.env.PI_CONFIG_DIR = path.join(cwd, ".missing-config-dir");
      delete process.env.PI_CODING_AGENT_DIR;
      delete process.env.PI_AGENT_DIR;
      process.env.HOME = path.join(cwd, ".missing-home");

      try {
        const loaded = await loadPiScopedModelCatalog(cwd);
        assert.deepEqual(loaded.models, []);
        assert.equal(loaded.source, undefined);
        assert.equal(loaded.sourcePath, undefined);
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

        if (priorHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = priorHome;
        }
      }
    });
  },
);

defineTest(
  "scoped model loader discovers non-default providers from settings without hardcoded lists (demo)",
  async () => {
    await withTempDir(async (cwd) => {
      resetPiScopedModelCatalogCache();

      const envDir = path.join(cwd, ".pi-global");
      const envSettingsPath = path.join(envDir, "settings.json");
      writeSettingsFile(envSettingsPath, {
        enabledModels: ["router-labs/nebula-1", "router-labs/nebula-1:high"],
      });

      const priorConfigDir = process.env.PI_CONFIG_DIR;
      process.env.PI_CONFIG_DIR = envDir;

      try {
        const loaded = await loadPiScopedModelCatalog(cwd);
        assert.equal(loaded.source, "env_pi_config_dir");
        assert.equal(loaded.sourcePath, envSettingsPath);
        assert.deepEqual(loaded.models, [
          {
            provider: "router-labs",
            modelId: "nebula-1",
            pattern: "router-labs/nebula-1",
          },
        ]);
      } finally {
        if (priorConfigDir === undefined) {
          delete process.env.PI_CONFIG_DIR;
        } else {
          process.env.PI_CONFIG_DIR = priorConfigDir;
        }
      }
    });
  },
);
