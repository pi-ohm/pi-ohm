import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultOhmConfig, type OhmRuntimeConfig } from "@pi-ohm/config";
import { resolveRuntimeSubagentById, resolveRuntimeSubagentCatalog } from "../subagent-profiles";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

function withConfig(mutate: (config: OhmRuntimeConfig) => void): OhmRuntimeConfig {
  const config = getDefaultOhmConfig();
  mutate(config);
  return config;
}

defineTest("resolveRuntimeSubagentById applies built-in overrides", () => {
  const config = withConfig((next) => {
    if (!next.subagents) return;
    next.subagents.profiles.librarian = {
      prompt: "{file:./prompts/librarian.general.txt}",
      description: "Custom librarian summary",
      whenToUse: ["Custom usage line"],
    };
  });

  const resolved = resolveRuntimeSubagentById({
    subagentId: "librarian",
    config,
  });

  assert.equal(resolved?.summary, "Custom librarian summary");
  assert.deepEqual(resolved?.whenToUse, ["Custom usage line"]);
  assert.equal(resolved?.scaffoldPrompt, "{file:./prompts/librarian.general.txt}");
});

defineTest("resolveRuntimeSubagentById resolves custom subagent profile", () => {
  const config = withConfig((next) => {
    if (!next.subagents) return;
    next.subagents.profiles["my-custom-agent"] = {
      prompt: "{file:./prompts/my-custom-agent.general.txt}",
      description: "Custom profile summary",
      whenToUse: ["Use for custom delegated tasks"],
    };
  });

  const resolved = resolveRuntimeSubagentById({
    subagentId: "my-custom-agent",
    config,
  });

  assert.equal(resolved?.id, "my-custom-agent");
  assert.equal(resolved?.name, "My Custom Agent");
  assert.equal(resolved?.summary, "Custom profile summary");
  assert.deepEqual(resolved?.whenToUse, ["Use for custom delegated tasks"]);
  assert.equal(resolved?.scaffoldPrompt, "{file:./prompts/my-custom-agent.general.txt}");
});

defineTest("resolveRuntimeSubagentById matches wildcard variant key by model token", () => {
  const config = withConfig((next) => {
    if (!next.subagents) return;
    next.subagents.profiles["my-custom-agent"] = {
      prompt: "{file:./prompts/my-custom-agent.general.txt}",
      description: "General summary",
      whenToUse: ["General usage"],
      variants: {
        "*gemini*": {
          prompt: "{file:./prompts/my-custom-agent.gemini.txt}",
          description: "Gemini summary",
          whenToUse: ["Gemini usage"],
        },
      },
    };
  });

  const resolved = resolveRuntimeSubagentById({
    subagentId: "my-custom-agent",
    config,
    modelPattern: "github-copilot/gemini-3.1-pro-preview:high",
  });

  assert.equal(resolved?.summary, "Gemini summary");
  assert.deepEqual(resolved?.whenToUse, ["Gemini usage"]);
  assert.equal(resolved?.scaffoldPrompt, "{file:./prompts/my-custom-agent.gemini.txt}");
});

defineTest("resolveRuntimeSubagentCatalog includes built-ins and custom profiles", () => {
  const config = withConfig((next) => {
    if (!next.subagents) return;
    next.subagents.profiles["my-custom-agent"] = {
      prompt: "{file:./prompts/my-custom-agent.general.txt}",
      description: "Custom profile summary",
      whenToUse: ["Use for custom delegated tasks"],
    };
  });

  const catalog = resolveRuntimeSubagentCatalog(config);
  const hasLibrarian = catalog.some((subagent) => subagent.id === "librarian");
  const hasCustom = catalog.some((subagent) => subagent.id === "my-custom-agent");

  assert.equal(hasLibrarian, true);
  assert.equal(hasCustom, true);
});
