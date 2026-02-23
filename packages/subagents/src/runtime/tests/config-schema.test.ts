import assert from "node:assert/strict";
import test from "node:test";
import { parseSubagentProfilePatch, parseSubagentProfileVariantPatch } from "@pi-ohm/config";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("parseSubagentProfileVariantPatch parses normalized variant patch", () => {
  const parsed = parseSubagentProfileVariantPatch({
    model: " github-copilot/gemini-3.1-pro-preview:high ",
    prompt: " {file:./prompts/custom.gemini.txt} ",
    description: " Gemini variant ",
    whenToUse: [" fast path ", " precision path "],
    permissions: {
      BASH: "allow",
      edit: "deny",
      write: "inherit",
    },
  });

  assert.deepEqual(parsed, {
    model: "github-copilot/gemini-3.1-pro-preview:high",
    prompt: "{file:./prompts/custom.gemini.txt}",
    description: "Gemini variant",
    whenToUse: ["fast path", "precision path"],
    permissions: {
      bash: "allow",
      edit: "deny",
      write: "inherit",
    },
  });
});

defineTest("parseSubagentProfilePatch parses variant map with wildcard keys", () => {
  const parsed = parseSubagentProfilePatch({
    model: "openai/gpt-5.3-codex:medium",
    prompt: "{file:./prompts/custom.general.txt}",
    description: "Custom profile",
    whenToUse: ["General use"],
    permissions: {
      bash: "allow",
      edit: "deny",
    },
    variants: {
      " *gemini* ": {
        model: "google/gemini-3-flash-preview",
        permissions: {
          edit: "inherit",
        },
      },
    },
  });

  assert.deepEqual(parsed, {
    model: "openai/gpt-5.3-codex:medium",
    prompt: "{file:./prompts/custom.general.txt}",
    description: "Custom profile",
    whenToUse: ["General use"],
    permissions: {
      bash: "allow",
      edit: "deny",
    },
    variants: {
      "*gemini*": {
        model: "google/gemini-3-flash-preview",
        permissions: {
          edit: "inherit",
        },
      },
    },
  });
});

defineTest("parseSubagentProfilePatch strips invalid nested entries but keeps valid fields", () => {
  const parsed = parseSubagentProfilePatch({
    model: "",
    prompt: "{file:./prompts/custom.general.txt}",
    variants: {
      "*gemini*": {
        whenToUse: [],
      },
    },
  });

  assert.deepEqual(parsed, {
    prompt: "{file:./prompts/custom.general.txt}",
    variants: {
      "*gemini*": {},
    },
  });
});
