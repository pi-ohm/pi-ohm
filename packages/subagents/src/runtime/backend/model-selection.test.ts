import assert from "node:assert/strict";
import test from "node:test";
import { parseSubagentModelSelection } from "./model-selection";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("model-selection parses provider/model with thinking suffix", () => {
  const parsed = parseSubagentModelSelection({
    modelPattern: "openai-codex/gpt-5.3-codex:medium",
    hasModel: (provider, modelId) => provider === "openai-codex" && modelId === "gpt-5.3-codex",
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    assert.fail("Expected model parse success");
  }

  assert.equal(parsed.value.provider, "openai-codex");
  assert.equal(parsed.value.modelId, "gpt-5.3-codex");
  assert.equal(parsed.value.thinkingLevel, "medium");
});
