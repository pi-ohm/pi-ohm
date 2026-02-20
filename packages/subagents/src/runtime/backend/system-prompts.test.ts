import assert from "node:assert/strict";
import test from "node:test";
import { buildSubagentSdkSystemPrompt, resolveSubagentPromptProfile } from "./system-prompts";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("resolveSubagentPromptProfile detects anthropic/claude", () => {
  assert.equal(
    resolveSubagentPromptProfile({ provider: "anthropic", modelId: "claude-3-7-sonnet" }),
    "anthropic",
  );
  assert.equal(
    resolveSubagentPromptProfile({ modelPattern: "anthropic/claude-opus-4" }),
    "anthropic",
  );
});

defineTest("resolveSubagentPromptProfile detects openai/gpt", () => {
  assert.equal(resolveSubagentPromptProfile({ provider: "openai", modelId: "gpt-5" }), "openai");
  assert.equal(resolveSubagentPromptProfile({ modelPattern: "openai/gpt-4.1" }), "openai");
});

defineTest("resolveSubagentPromptProfile detects google/gemini", () => {
  assert.equal(resolveSubagentPromptProfile({ provider: "google" }), "google");
  assert.equal(resolveSubagentPromptProfile({ modelId: "gemini-2.5-pro" }), "google");
});

defineTest("resolveSubagentPromptProfile detects moonshot/kimi", () => {
  assert.equal(resolveSubagentPromptProfile({ provider: "moonshot.ai" }), "moonshot");
  assert.equal(resolveSubagentPromptProfile({ modelId: "kimi-k2" }), "moonshot");
  assert.equal(resolveSubagentPromptProfile({ modelPattern: "moonshotai/kimi-k2" }), "moonshot");
});

defineTest("buildSubagentSdkSystemPrompt includes provider profile header", () => {
  const prompt = buildSubagentSdkSystemPrompt({ provider: "anthropic", modelId: "claude-opus-4" });

  assert.match(prompt, /Provider profile: anthropic/);
  assert.match(prompt, /Pi OHM subagent runtime/);
  assert.match(prompt, /Use available tools only when required/);
});

defineTest("resolveSubagentPromptProfile infers profile from scoped model consensus", () => {
  const profile = resolveSubagentPromptProfile({
    provider: "acme-router",
    modelId: "custom-model-x",
    scopedModels: [
      {
        provider: "acme-router",
        modelId: "claude-opus-4.6",
        pattern: "acme-router/claude-opus-4.6",
      },
      {
        provider: "acme-router",
        modelId: "claude-haiku-4.5",
        pattern: "acme-router/claude-haiku-4.5",
      },
    ],
  });

  assert.equal(profile, "anthropic");
});

defineTest(
  "resolveSubagentPromptProfile keeps generic when scoped provider profiles conflict",
  () => {
    const profile = resolveSubagentPromptProfile({
      provider: "mixed-router",
      modelId: "custom-model-x",
      scopedModels: [
        {
          provider: "mixed-router",
          modelId: "claude-opus-4.6",
          pattern: "mixed-router/claude-opus-4.6",
        },
        {
          provider: "mixed-router",
          modelId: "gemini-3-pro-preview",
          pattern: "mixed-router/gemini-3-pro-preview",
        },
      ],
    });

    assert.equal(profile, "generic");
  },
);
