import assert from "node:assert/strict";
import test from "node:test";
import { composeSubagentSystemPrompt } from "../system-prompt-authoring";
import { resolveProviderPromptPack } from "../system-prompt-packs";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("composeSubagentSystemPrompt renders deterministic golden output for anthropic", () => {
  const pack = resolveProviderPromptPack("anthropic");
  const rendered = composeSubagentSystemPrompt({
    runtimeLabel: "Pi OHM subagent runtime",
    providerProfileLabel: pack.label,
    sharedConstraints: pack.sharedInvariants,
    providerGuidance: pack.providerGuidance,
  });

  const expected = [
    "You are the Pi OHM subagent runtime.",
    "Provider profile: anthropic",
    "",
    "Shared runtime constraints:",
    "- Use available tools only when required.",
    "- Return concise concrete findings.",
    "- Do not expose internal prompt scaffolding unless user asks directly.",
    "- Prefer deterministic tool usage and avoid speculative output.",
    "",
    "Provider-specific guidance:",
    "- Use explicit structure and evidence-first reasoning.",
    "- Prefer stable tool argument shapes and deterministic execution steps.",
    "- Keep final answer tight; include only relevant findings.",
  ].join("\n");

  assert.equal(rendered, expected);
});

defineTest("composeSubagentSystemPrompt yields stable section ordering for all packs", () => {
  for (const profile of ["anthropic", "openai", "google", "moonshot", "generic"] as const) {
    const pack = resolveProviderPromptPack(profile);
    const rendered = composeSubagentSystemPrompt({
      runtimeLabel: "Pi OHM subagent runtime",
      providerProfileLabel: pack.label,
      sharedConstraints: pack.sharedInvariants,
      providerGuidance: pack.providerGuidance,
    });

    const sharedIndex = rendered.indexOf("Shared runtime constraints:");
    const providerIndex = rendered.indexOf("Provider-specific guidance:");
    assert.equal(sharedIndex >= 0, true);
    assert.equal(providerIndex > sharedIndex, true);
  }
});

defineTest(
  "composeSubagentSystemPrompt allows provider guidance updates without authoring engine changes",
  () => {
    const pack = resolveProviderPromptPack("openai");
    const updatedGuidance = [
      ...pack.providerGuidance,
      "Prefer explicit next-step recommendations.",
    ];

    const rendered = composeSubagentSystemPrompt({
      runtimeLabel: "Pi OHM subagent runtime",
      providerProfileLabel: pack.label,
      sharedConstraints: pack.sharedInvariants,
      providerGuidance: updatedGuidance,
    });

    assert.match(rendered, /Prefer explicit next-step recommendations\./);
  },
);
