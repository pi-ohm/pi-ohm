import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Result } from "better-result";
import { loadConfig, pickConfig } from "@pi-ohm/core/config";
import {
  getSubagentConfiguredModel,
  isSubagentRuntimeConfig,
  resolveSubagentAgentRuntimeConfig,
  subagentsConfigModule,
} from "../config";

async function withConfig<T>(run: (input: { readonly cwd: string }) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-subagents-config-"));
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
    if (previousConfig === undefined) delete process.env.PI_CONFIG_DIR;
    if (previousConfig !== undefined) process.env.PI_CONFIG_DIR = previousConfig;
    if (previousCoding === undefined) delete process.env.PI_CODING_AGENT_DIR;
    if (previousCoding !== undefined) process.env.PI_CODING_AGENT_DIR = previousCoding;
    if (previousAgent === undefined) delete process.env.PI_AGENT_DIR;
    if (previousAgent !== undefined) process.env.PI_AGENT_DIR = previousAgent;
    await fs.rm(dir, { recursive: true, force: true });
  });
}

void test("subagents config smoke resolves every runtime option from project ohm.json", async () => {
  await withConfig(async ({ cwd }) => {
    await fs.writeFile(
      path.join(cwd, ".pi", "ohm.json"),
      JSON.stringify({
        subagents: {
          backend: "custom-plugin",
          taskMaxConcurrency: 9,
          taskRetentionMs: 12345,
          permissions: {
            default: "deny",
            subagents: {
              reviewer: "allow",
              oracle: "ask",
            },
            allowInternalRouting: "yes",
          },
          reviewer: {
            disabled: false,
            model: "OpenAI-Codex/gpt-5.4-mini:medium",
            thinking: "high",
            tools: ["read", "grep", "bash"],
            maxTurns: 12,
            prompt: "review prompt",
            description: "Review diffs and check implementation quality.",
            permissions: {
              bash: "deny",
              grep: "allow",
            },
            variants: {
              "*gpt-5.4-mini*": {
                disabled: true,
                model: "openai-codex/gpt-5.4-mini:low",
                thinking: "minimal",
                tools: ["read", "grep"],
                maxTurns: 4,
                prompt: "variant prompt",
                description: "Variant reviewer description.",
                permissions: {
                  bash: "inherit",
                  grep: "deny",
                },
              },
            },
          },
          librarian: {
            disabled: true,
            model: "anthropic/claude-sonnet-4-5:high",
            thinking: "medium",
            tools: ["read", "find"],
            maxTurns: 5,
            prompt: "inline prompt",
            description: "inline description",
            permissions: {
              read: "allow",
              find: "deny",
            },
          },
        },
      }),
      "utf8",
    );

    const loaded = await loadConfig({ cwd, modules: [subagentsConfigModule] });

    assert.equal(Result.isOk(loaded), true);
    if (Result.isError(loaded)) assert.fail(loaded.error.message);
    const config = pickConfig({
      loaded: loaded.value,
      module: subagentsConfigModule,
      is: isSubagentRuntimeConfig,
    });

    assert.equal(Result.isOk(config), true);
    if (Result.isError(config)) assert.fail(config.error.message);
    assert.equal(config.value.backend, "custom-plugin");
    assert.equal(config.value.taskMaxConcurrency, 9);
    assert.equal(config.value.taskRetentionMs, 12345);
    assert.deepEqual(config.value.permissions, {
      default: "deny",
      subagents: { reviewer: "allow", oracle: "deny" },
      allowInternalRouting: true,
    });
    assert.equal(
      getSubagentConfiguredModel({ subagents: config.value }, "reviewer"),
      "openai-codex/gpt-5.4-mini:medium",
    );

    const reviewer = resolveSubagentAgentRuntimeConfig({
      config: { subagents: config.value },
      subagentId: "reviewer",
      modelPattern: "openai-codex/gpt-5.4-mini:medium",
    });
    assert.deepEqual(reviewer, {
      disabled: true,
      model: "openai-codex/gpt-5.4-mini:low",
      thinking: "minimal",
      tools: ["read", "grep"],
      maxTurns: 4,
      prompt: "variant prompt",
      description: "Variant reviewer description.",
      permissions: { bash: "deny", grep: "deny" },
      variantPattern: "*gpt-5.4-mini*",
    });

    const librarian = resolveSubagentAgentRuntimeConfig({
      config: { subagents: config.value },
      subagentId: "librarian",
    });
    assert.deepEqual(librarian, {
      disabled: true,
      model: "anthropic/claude-sonnet-4-5:high",
      thinking: "medium",
      tools: ["read", "find"],
      maxTurns: 5,
      prompt: "inline prompt",
      description: "inline description",
      permissions: { read: "allow", find: "deny" },
    });
  });
});
