import assert from "node:assert/strict";
import test from "node:test";
import { resolveProviderPromptPack, type PromptPackProfile } from "../system-prompt-packs";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("resolveProviderPromptPack returns pack for each profile", () => {
  const profiles: readonly PromptPackProfile[] = [
    "anthropic",
    "openai",
    "google",
    "moonshot",
    "generic",
  ];

  for (const profile of profiles) {
    const pack = resolveProviderPromptPack(profile);
    assert.equal(pack.profile, profile);
    assert.equal(pack.sharedInvariants.length > 0, true);
    assert.equal(pack.providerGuidance.length > 0, true);
  }
});

defineTest("resolveProviderPromptPack keeps shared invariant section stable across packs", () => {
  const baseline = resolveProviderPromptPack("anthropic").sharedInvariants;

  for (const profile of ["openai", "google", "moonshot", "generic"] as const) {
    const pack = resolveProviderPromptPack(profile);
    assert.deepEqual(pack.sharedInvariants, baseline);
  }
});
