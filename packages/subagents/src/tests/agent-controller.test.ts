import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { Result } from "better-result";
import {
  createSubagentToolRuntime,
  createSubagentTools,
  resolveAvailableAgents,
  resolveSpawnConfig,
} from "../agent-controller";

void test("createSubagentTools registers individual lifecycle tools", () => {
  const pi = {
    appendEntry(customType: string, data?: unknown) {
      assert.equal(customType.length > 0, true);
      assert.equal(data !== undefined, true);
    },
    getThinkingLevel(): "medium" {
      return "medium";
    },
  };

  const tools = createSubagentTools(createSubagentToolRuntime(pi));

  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      "spawn_agent",
      "send_agent_input",
      "wait_agent",
      "close_agent",
      "resume_agent",
      "get_agent_result",
      "list_agents",
    ],
  );
});

async function withConfig<T>(
  run: (input: { readonly cwd: string; readonly agent: string }) => Promise<T>,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-subagents-tools-"));
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

  return run({ cwd, agent }).finally(async () => {
    if (previousConfig === undefined) delete process.env.PI_CONFIG_DIR;
    if (previousConfig !== undefined) process.env.PI_CONFIG_DIR = previousConfig;
    if (previousCoding === undefined) delete process.env.PI_CODING_AGENT_DIR;
    if (previousCoding !== undefined) process.env.PI_CODING_AGENT_DIR = previousCoding;
    if (previousAgent === undefined) delete process.env.PI_AGENT_DIR;
    if (previousAgent !== undefined) process.env.PI_AGENT_DIR = previousAgent;
    await fs.rm(dir, { recursive: true, force: true });
  });
}

void test("resolveSpawnConfig applies agent prompt, model thinking, tools, and tool denies", async () => {
  await withConfig(async ({ cwd }) => {
    await fs.writeFile(
      path.join(cwd, ".pi", "ohm.json"),
      JSON.stringify({
        subagents: {
          reviewer: {
            model: "custom-provider/custom-model:high",
            tools: ["read", "grep", "bash"],
            prompt: "agent prompt",
            permissions: {
              bash: "deny",
              grep: "allow",
            },
          },
        },
      }),
      "utf8",
    );

    const config = await resolveSpawnConfig({
      cwd,
      params: {
        task_name: "reviewer",
        agent_type: "reviewer",
        prompt: "inspect this diff",
        summary: "review summary",
      },
    });

    assert.equal(Result.isOk(config), true);
    if (Result.isError(config)) assert.fail(config.error.message);
    assert.equal(config.value.agentType, "reviewer");
    assert.equal(config.value.model.provider, "custom-provider");
    assert.equal(config.value.model.id, "custom-model");
    assert.equal(config.value.model.api, "custom-provider");
    assert.equal(config.value.thinking, "high");
    assert.deepEqual(config.value.tools, ["read", "grep"]);
    assert.equal(config.value.prompt, "agent prompt\n\nTask:\ninspect this diff");
  });
});

void test("resolveSpawnConfig uses Pi model registry custom providers before external fallback", async () => {
  await withConfig(async ({ cwd, agent }) => {
    await fs.writeFile(
      path.join(agent, "models.json"),
      JSON.stringify({
        providers: {
          "registry-provider": {
            api: "openai-completions",
            baseUrl: "https://registry-provider.example/v1",
            apiKey: "test-key",
            models: [
              {
                id: "registry-model",
                name: "Registry Model",
                reasoning: false,
                input: ["text"],
                contextWindow: 32000,
                maxTokens: 4096,
              },
            ],
          },
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(cwd, ".pi", "ohm.json"),
      JSON.stringify({
        subagents: {
          researcher: {
            model: "registry-provider/registry-model:medium",
          },
        },
      }),
      "utf8",
    );

    const config = await resolveSpawnConfig({
      cwd,
      params: {
        task_name: "researcher",
        agent_type: "researcher",
        prompt: "find facts",
        summary: "research summary",
      },
    });

    assert.equal(Result.isOk(config), true);
    if (Result.isError(config)) assert.fail(config.error.message);
    assert.equal(config.value.model.provider, "registry-provider");
    assert.equal(config.value.model.id, "registry-model");
    assert.equal(config.value.model.api, "openai-completions");
    assert.equal(config.value.model.baseUrl, "https://registry-provider.example/v1");
    assert.equal(config.value.model.contextWindow, 32000);
  });
});

void test("resolveSpawnConfig defaults to current session model when no model is configured", async () => {
  await withConfig(async ({ cwd }) => {
    await fs.writeFile(
      path.join(cwd, ".pi", "ohm.json"),
      JSON.stringify({
        subagents: {
          reviewer: {
            tools: ["read"],
            prompt: "agent prompt",
          },
        },
      }),
      "utf8",
    );

    const currentModel = {
      id: "main-model",
      name: "Main Model",
      api: "external-main-provider",
      provider: "external-main-provider",
      baseUrl: "https://main-provider.example/v1",
      reasoning: true,
      input: ["text"],
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 200000,
      maxTokens: 20000,
    } satisfies Model<Api>;

    const config = await resolveSpawnConfig({
      cwd,
      currentModel,
      currentThinking: "xhigh",
      params: {
        task_name: "reviewer",
        agent_type: "reviewer",
        prompt: "inspect this diff",
        summary: "review summary",
      },
    });

    assert.equal(Result.isOk(config), true);
    if (Result.isError(config)) assert.fail(config.error.message);
    assert.equal(config.value.model, currentModel);
    assert.equal(config.value.modelKey, "external-main-provider/main-model");
    assert.equal(config.value.thinking, "xhigh");
    assert.deepEqual(config.value.tools, ["read"]);
    assert.equal(config.value.prompt, "agent prompt\n\nTask:\ninspect this diff");
  });
});

void test("resolveSpawnConfig lets spawn args override configured model and thinking", async () => {
  await withConfig(async ({ cwd }) => {
    await fs.writeFile(
      path.join(cwd, ".pi", "ohm.json"),
      JSON.stringify({
        subagents: {
          researcher: {
            model: "custom-provider/configured-model:high",
            tools: ["read"],
          },
        },
      }),
      "utf8",
    );

    const config = await resolveSpawnConfig({
      cwd,
      params: {
        task_name: "researcher",
        agent_type: "researcher",
        prompt: "find facts",
        summary: "research summary",
        model: "external-provider/runtime-model:minimal",
        thinking: "off",
      },
    });

    assert.equal(Result.isOk(config), true);
    if (Result.isError(config)) assert.fail(config.error.message);
    assert.equal(config.value.model.provider, "external-provider");
    assert.equal(config.value.model.id, "runtime-model");
    assert.equal(config.value.thinking, "off");
  });
});

void test("resolveSpawnConfig hides disabled subagents from model-facing tools", async () => {
  await withConfig(async ({ cwd }) => {
    await fs.writeFile(
      path.join(cwd, ".pi", "ohm.json"),
      JSON.stringify({
        subagents: {
          reviewer: {
            disabled: true,
            prompt: "secret disabled reviewer prompt",
          },
        },
      }),
      "utf8",
    );

    const config = await resolveSpawnConfig({
      cwd,
      params: {
        task_name: "reviewer",
        agent_type: "reviewer",
        prompt: "inspect this diff",
        summary: "review summary",
      },
    });

    assert.equal(Result.isError(config), true);
    if (Result.isOk(config)) assert.fail("Expected disabled subagent error");
    assert.equal(config.error.message, "Subagent 'reviewer' was not found");
    assert.equal(config.error.message.includes("secret disabled reviewer prompt"), false);
  });
});

void test("resolveAvailableAgents exposes descriptions and omits disabled agents", async () => {
  await withConfig(async ({ cwd }) => {
    await fs.writeFile(
      path.join(cwd, ".pi", "ohm.json"),
      JSON.stringify({
        subagents: {
          librarian: {
            disabled: true,
            description: "secret disabled librarian description",
            prompt: "secret disabled librarian prompt",
          },
          reviewer: {
            description: "Use for reviewing diffs and checking implementation quality.",
            prompt: "secret reviewer prompt",
          },
          hidden: {
            disabled: true,
            description: "secret hidden description",
            prompt: "secret hidden prompt",
          },
        },
      }),
      "utf8",
    );

    const agents = await resolveAvailableAgents({ cwd });

    assert.equal(Result.isOk(agents), true);
    if (Result.isError(agents)) assert.fail(agents.error.message);
    assert.deepEqual(
      agents.value.map((agent) => agent.name),
      ["oracle", "finder", "reviewer"],
    );
    assert.deepEqual(agents.value.at(-1), {
      name: "reviewer",
      description: "Use for reviewing diffs and checking implementation quality.",
      source: "custom",
    });
    const modelVisible = JSON.stringify(agents.value);
    assert.equal(modelVisible.includes("secret disabled librarian"), false);
    assert.equal(modelVisible.includes("secret hidden"), false);
    assert.equal(modelVisible.includes("secret reviewer prompt"), false);
  });
});
