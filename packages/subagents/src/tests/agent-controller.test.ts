import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import { Value } from "typebox/value";
import {
  createSubagentToolRuntime,
  createSubagentTools,
  resolveAvailableAgents,
  resolveForkMode,
  resolveSpawnConfig,
  sliceForkEntries,
} from "../agent-controller";

void test("createSubagentTools registers the Codex v2 tool surface", () => {
  const pi = {
    appendEntry(customType: string, data?: unknown) {
      assert.equal(customType.length > 0, true);
      assert.equal(data !== undefined, true);
    },
    getThinkingLevel(): "medium" {
      return "medium";
    },
    sendMessage() {
      return undefined;
    },
  };

  const tools = createSubagentTools(createSubagentToolRuntime(pi));

  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      "spawn_agent",
      "send_message",
      "followup_task",
      "wait_agent",
      "interrupt_agent",
      "list_agents",
    ],
  );
});

void test("createSubagentTools uses v2-only argument schemas", () => {
  const pi = {
    appendEntry(customType: string, data?: unknown) {
      assert.equal(customType.length > 0, true);
      assert.equal(data !== undefined, true);
    },
    getThinkingLevel(): "medium" {
      return "medium";
    },
    sendMessage() {
      return undefined;
    },
  };
  const tools = createSubagentTools(createSubagentToolRuntime(pi));
  const spawn = tools.find((tool) => tool.name === "spawn_agent");
  const send = tools.find((tool) => tool.name === "send_message");
  const followup = tools.find((tool) => tool.name === "followup_task");
  const wait = tools.find((tool) => tool.name === "wait_agent");

  assert.ok(spawn);
  assert.ok(send);
  assert.ok(followup);
  assert.ok(wait);
  assert.equal(
    Value.Check(spawn.parameters, {
      task_name: "inspect_task",
      message: "inspect this diff",
      fork_turns: "none",
      reasoning_effort: "high",
    }),
    true,
  );
  assert.equal(
    Value.Check(spawn.parameters, {
      task_name: "inspect_task",
      prompt: "legacy prompt",
      summary: "legacy summary",
      fork_context: true,
    }),
    false,
  );
  assert.equal(Value.Check(send.parameters, { target: "/root/a", message: "note" }), true);
  assert.equal(
    Value.Check(send.parameters, { target: "/root/a", message: "note", interrupt: true }),
    false,
  );
  assert.equal(
    Value.Check(followup.parameters, { target: "/root/a", message: "task", items: [] }),
    false,
  );
  assert.equal(Value.Check(wait.parameters, { timeout_ms: 1 }), true);
  assert.equal(Value.Check(wait.parameters, { targets: ["/root/a"], timeout_ms: 1 }), false);
});

void test("resolveForkMode accepts last-N fork_turns", () => {
  const fork = resolveForkMode("2");

  assert.equal(Result.isOk(fork), true);
  if (Result.isError(fork)) assert.fail(fork.error.message);
  assert.deepEqual(fork.value, { kind: "last", turns: 2 });

  const zero = resolveForkMode("0");
  assert.equal(Result.isError(zero), true);
  const invalid = resolveForkMode("banana");
  assert.equal(Result.isError(invalid), true);
});

void test("sliceForkEntries keeps the last N user turns and rechains the suffix", () => {
  const entries = [
    customEntry("startup", null),
    userEntry("u1", "startup", "one"),
    customEntry("tool1", "u1"),
    userEntry("u2", "tool1", "two"),
    customEntry("tool2", "u2"),
    userEntry("u3", "tool2", "three"),
  ];

  const sliced = sliceForkEntries(entries, 2);

  assert.deepEqual(
    sliced.map((entry) => entry.id),
    ["u2", "tool2", "u3"],
  );
  assert.deepEqual(
    sliced.map((entry) => entry.parentId),
    [null, "u2", "tool2"],
  );
});

void test("sliceForkEntries drops startup prefix when requested turns exceed history", () => {
  const entries = [customEntry("startup", null), userEntry("u1", "startup", "one")];

  const sliced = sliceForkEntries(entries, 10);

  assert.deepEqual(
    sliced.map((entry) => entry.id),
    ["u1"],
  );
  assert.deepEqual(
    sliced.map((entry) => entry.parentId),
    [null],
  );
});

void test("sliceForkEntries returns no context when there are no user turns", () => {
  assert.deepEqual(sliceForkEntries([customEntry("startup", null)], 1), []);
});

function userEntry(id: string, parentId: string | null, content: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "user",
      content,
      timestamp: 1,
    },
  };
}

function customEntry(id: string, parentId: string | null): SessionEntry {
  return {
    type: "custom",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType: "test",
  };
}

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
        message: "inspect this diff",
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
        message: "find facts",
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

void test("resolveSpawnConfig uses the default agent config when agent_type is omitted", async () => {
  await withConfig(async ({ cwd }) => {
    await fs.writeFile(
      path.join(cwd, ".pi", "ohm.json"),
      JSON.stringify({
        subagents: {
          default: {
            tools: ["read"],
            prompt: "default agent prompt",
          },
        },
      }),
      "utf8",
    );

    const config = await resolveSpawnConfig({
      cwd,
      params: {
        task_name: "inspect_task",
        message: "inspect this diff",
      },
    });

    assert.equal(Result.isOk(config), true);
    if (Result.isError(config)) assert.fail(config.error.message);
    assert.equal(config.value.agentType, "default");
    assert.deepEqual(config.value.tools, ["read"]);
    assert.equal(config.value.prompt, "default agent prompt\n\nTask:\ninspect this diff");
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
        message: "inspect this diff",
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

void test("resolveSpawnConfig lets spawn args override configured model and reasoning effort", async () => {
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
        message: "find facts",
        model: "external-provider/runtime-model:minimal",
        reasoning_effort: "off",
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
        message: "inspect this diff",
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
