import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSubagentSdkSystemPrompt,
  resolveSubagentPromptProfile,
  resolveSubagentPromptProfileSelection,
} from "./system-prompts";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("resolveSubagentPromptProfile detects anthropic/openai/google/moonshot", () => {
  assert.equal(
    resolveSubagentPromptProfile({ provider: "anthropic", modelId: "claude-3-7-sonnet" }),
    "anthropic",
  );
  assert.equal(resolveSubagentPromptProfile({ modelPattern: "openai/gpt-4.1" }), "openai");
  assert.equal(
    resolveSubagentPromptProfile({ provider: "google", modelId: "gemini-2.5-pro" }),
    "google",
  );
  assert.equal(resolveSubagentPromptProfile({ modelPattern: "moonshotai/kimi-k2" }), "moonshot");
});

defineTest("resolveSubagentPromptProfile honors custom profile rules", () => {
  const profile = resolveSubagentPromptProfile({
    provider: "router-z",
    modelId: "custom-model",
    profileRules: [
      {
        profile: "google",
        priority: 100,
        match: {
          providers: ["router-z"],
          models: [],
        },
      },
    ],
  });

  assert.equal(profile, "google");
});

defineTest("resolveSubagentPromptProfileSelection prioritizes active runtime model", () => {
  const selection = resolveSubagentPromptProfileSelection({
    provider: "google",
    modelId: "gemini-3-pro-preview",
    modelPattern: "anthropic/claude-opus-4.6",
  });

  assert.deepEqual(selection, {
    profile: "google",
    source: "active_model",
    reason: "active_model_direct_match",
  });
});

defineTest(
  "resolveSubagentPromptProfileSelection uses explicit model pattern when active model is unavailable",
  () => {
    const selection = resolveSubagentPromptProfileSelection({
      modelPattern: "openai/gpt-5:high",
    });

    assert.deepEqual(selection, {
      profile: "openai",
      source: "explicit_model_pattern",
      reason: "explicit_model_pattern_direct_match",
    });
  },
);

defineTest(
  "resolveSubagentPromptProfileSelection uses scoped provider consensus for active model",
  () => {
    const selection = resolveSubagentPromptProfileSelection({
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

    assert.deepEqual(selection, {
      profile: "anthropic",
      source: "scoped_model_catalog",
      reason: "active_model_scoped_provider_consensus",
    });
  },
);

defineTest(
  "resolveSubagentPromptProfileSelection uses scoped provider consensus for explicit model pattern",
  () => {
    const selection = resolveSubagentPromptProfileSelection({
      modelPattern: "acme-router/custom-model-x",
      scopedModels: [
        {
          provider: "acme-router",
          modelId: "gemini-3-pro-preview",
          pattern: "acme-router/gemini-3-pro-preview",
        },
      ],
    });

    assert.deepEqual(selection, {
      profile: "google",
      source: "scoped_model_catalog",
      reason: "explicit_model_pattern_scoped_provider_consensus",
    });
  },
);

defineTest("resolveSubagentPromptProfileSelection reports scoped conflict fallback", () => {
  const selection = resolveSubagentPromptProfileSelection({
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

  assert.deepEqual(selection, {
    profile: "generic",
    source: "generic_fallback",
    reason: "scoped_models_conflict",
  });
});

defineTest(
  "resolveSubagentPromptProfileSelection reports no active model or explicit pattern",
  () => {
    const selection = resolveSubagentPromptProfileSelection({
      scopedModels: [
        {
          provider: "openai",
          modelId: "gpt-5",
          pattern: "openai/gpt-5",
        },
      ],
    });

    assert.deepEqual(selection, {
      profile: "generic",
      source: "generic_fallback",
      reason: "no_active_model_or_explicit_pattern",
    });
  },
);

defineTest(
  "resolveSubagentPromptProfileSelection reports no scoped models for unresolved direct profile",
  () => {
    const selection = resolveSubagentPromptProfileSelection({
      provider: "router-x",
      modelId: "custom-model",
    });

    assert.deepEqual(selection, {
      profile: "generic",
      source: "generic_fallback",
      reason: "no_scoped_models_available",
    });
  },
);

defineTest(
  "resolveSubagentPromptProfileSelection switches profile when only active model changes",
  () => {
    const sharedInput = {
      modelPattern: "openai/gpt-5:high",
      scopedModels: [
        {
          provider: "openai",
          modelId: "gpt-5",
          pattern: "openai/gpt-5",
        },
        {
          provider: "google",
          modelId: "gemini-3-pro-preview",
          pattern: "google/gemini-3-pro-preview",
        },
      ],
    };

    const first = resolveSubagentPromptProfileSelection({
      ...sharedInput,
      provider: "openai",
      modelId: "gpt-5",
    });
    const second = resolveSubagentPromptProfileSelection({
      ...sharedInput,
      provider: "google",
      modelId: "gemini-3-pro-preview",
    });

    assert.equal(first.profile, "openai");
    assert.equal(second.profile, "google");
    assert.equal(first.source, "active_model");
    assert.equal(second.source, "active_model");
  },
);

defineTest("buildSubagentSdkSystemPrompt includes provider profile header", () => {
  const prompt = buildSubagentSdkSystemPrompt({ provider: "anthropic", modelId: "claude-opus-4" });

  assert.match(prompt, /Provider profile: anthropic/);
  assert.match(prompt, /Pi OHM subagent runtime/);
  assert.match(prompt, /Use available tools only when required/);
});

defineTest("buildSubagentSdkSystemPrompt routes unknown provider to generic pack", () => {
  const prompt = buildSubagentSdkSystemPrompt({
    provider: "router-unknown",
    modelId: "custom-model",
  });

  assert.match(prompt, /Provider profile: generic/);
  assert.match(prompt, /Use neutral provider style: concise, concrete, and tool-grounded/);
});

defineTest(
  "buildSubagentSdkSystemPrompt emits distinct profile labels across provider families",
  () => {
    const anthropic = buildSubagentSdkSystemPrompt({
      provider: "anthropic",
      modelId: "claude-opus-4.6",
    });
    const openai = buildSubagentSdkSystemPrompt({
      provider: "openai",
      modelId: "gpt-5",
    });
    const google = buildSubagentSdkSystemPrompt({
      provider: "google",
      modelId: "gemini-3-pro-preview",
    });
    const moonshot = buildSubagentSdkSystemPrompt({
      provider: "moonshot.ai",
      modelId: "kimi-k2",
    });

    assert.match(anthropic, /Provider profile: anthropic/);
    assert.match(openai, /Provider profile: openai/);
    assert.match(google, /Provider profile: google/);
    assert.match(moonshot, /Provider profile: moonshot/);
  },
);

defineTest(
  "active model switch updates runtime prompt profile and rendered prompt header (demo)",
  () => {
    const shared = {
      modelPattern: "openai/gpt-5:high",
      scopedModels: [
        {
          provider: "openai",
          modelId: "gpt-5",
          pattern: "openai/gpt-5",
        },
        {
          provider: "google",
          modelId: "gemini-3-pro-preview",
          pattern: "google/gemini-3-pro-preview",
        },
      ],
    };

    const openAiSelection = resolveSubagentPromptProfileSelection({
      ...shared,
      provider: "openai",
      modelId: "gpt-5",
    });
    const googleSelection = resolveSubagentPromptProfileSelection({
      ...shared,
      provider: "google",
      modelId: "gemini-3-pro-preview",
    });

    const openAiPrompt = buildSubagentSdkSystemPrompt({
      ...shared,
      provider: "openai",
      modelId: "gpt-5",
    });
    const googlePrompt = buildSubagentSdkSystemPrompt({
      ...shared,
      provider: "google",
      modelId: "gemini-3-pro-preview",
    });

    assert.deepEqual(openAiSelection, {
      profile: "openai",
      source: "active_model",
      reason: "active_model_direct_match",
    });
    assert.deepEqual(googleSelection, {
      profile: "google",
      source: "active_model",
      reason: "active_model_direct_match",
    });

    assert.match(openAiPrompt, /Provider profile: openai/);
    assert.match(googlePrompt, /Provider profile: google/);
  },
);

defineTest(
  "new provider mapping can be added via rules and validated end-to-end without router changes (demo)",
  () => {
    const profileRules = [
      {
        profile: "google",
        priority: 900,
        match: {
          providers: ["acme-neon"],
          models: [],
        },
      },
    ] as const;

    const selection = resolveSubagentPromptProfileSelection({
      provider: "acme-neon",
      modelId: "spark-2",
      profileRules,
    });
    const prompt = buildSubagentSdkSystemPrompt({
      provider: "acme-neon",
      modelId: "spark-2",
      profileRules,
    });

    assert.deepEqual(selection, {
      profile: "google",
      source: "active_model",
      reason: "active_model_direct_match",
    });
    assert.match(prompt, /Provider profile: google/);
  },
);
