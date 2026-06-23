import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { Result } from "better-result";
import { resolvePipAgentConfig } from "../spawn-config";

void test("resolvePipAgentConfig inherits current model and thinking when no model is configured", () => {
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

  const config = resolvePipAgentConfig({
    config: { tools: ["read"], prompt: "review this" },
    currentModel,
    currentThinking: "xhigh",
  });

  assert.equal(Result.isOk(config), true);
  if (Result.isError(config)) assert.fail(config.error.message);
  assert.equal(config.value.model, currentModel);
  assert.equal(config.value.modelKey, "external-main-provider/main-model");
  assert.equal(config.value.thinking, "xhigh");
  assert.deepEqual(config.value.tools, ["read"]);
  assert.equal(config.value.prompt, "review this");
});

void test("resolvePipAgentConfig parses model suffix and registry models", async (context) => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-ohm-pip-config-"));
  context.after(() => {
    void rm(agentDir, { recursive: true, force: true });
  });
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    path.join(agentDir, "models.json"),
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

  const config = resolvePipAgentConfig({
    agentDir,
    config: { model: "registry-provider/registry-model:high", thinking: "off" },
  });

  assert.equal(Result.isOk(config), true);
  if (Result.isError(config)) assert.fail(config.error.message);
  assert.equal(config.value.model.provider, "registry-provider");
  assert.equal(config.value.model.id, "registry-model");
  assert.equal(config.value.model.api, "openai-completions");
  assert.equal(config.value.model.baseUrl, "https://registry-provider.example/v1");
  assert.equal(config.value.thinking, "off");
});
