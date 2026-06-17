import assert from "node:assert/strict";
import test from "node:test";
import type { AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import {
  bridgeReferencesAutocomplete,
  createReferencesAutocompleteProvider,
  findReferenceInvocations,
  renderReferenceInvocation,
  rewriteReferencePath,
} from "../extension";
import type { ReferenceInfo } from "../references";

const references: readonly ReferenceInfo[] = [
  {
    name: "opencode",
    path: "/cache/github.com/anomalyco/opencode",
    description: "OpenCode source",
    source: { type: "git", repository: "anomalyco/opencode", description: "OpenCode source" },
  },
  {
    name: "hidden",
    path: "/cache/hidden",
    hidden: true,
    source: { type: "local", path: "/cache/hidden", hidden: true },
  },
];

function provider(suggestions: AutocompleteSuggestions | null): AutocompleteProvider {
  return {
    async getSuggestions() {
      return suggestions;
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      const line = lines[cursorLine] ?? "";
      const before = line.slice(0, cursorCol - prefix.length);
      const after = line.slice(cursorCol);
      const next = [...lines];
      next[cursorLine] = `${before}${item.value}${after}`;
      return { lines: next, cursorLine, cursorCol: before.length + item.value.length };
    },
  };
}

void test("reference autocomplete merges with current provider for same @ prefix", async () => {
  const current = provider({
    prefix: "@op",
    items: [{ value: "@other.ts", label: "other.ts" }],
  });
  const wrapped = createReferencesAutocompleteProvider(current, () => references);
  const controller = new AbortController();

  const suggestions = await wrapped.getSuggestions(["read @op"], 0, "read @op".length, {
    signal: controller.signal,
  });

  assert.ok(suggestions);
  assert.deepEqual(wrapped.triggerCharacters, ["@"]);
  assert.equal(suggestions.prefix, "@op");
  assert.deepEqual(
    suggestions.items.map((item) => item.label),
    ["@opencode", "other.ts"],
  );
  assert.equal(suggestions.items[0]?.value, "@opencode");
  assert.equal(suggestions.items[0]?.description, "[Ω:REF] anomalyco/opencode");
});

void test("reference autocomplete delegates when no visible reference matches", async () => {
  const current = provider({
    prefix: "@hi",
    items: [{ value: "@hit.ts", label: "hit.ts" }],
  });
  const wrapped = createReferencesAutocompleteProvider(current, () => references);
  const controller = new AbortController();

  const suggestions = await wrapped.getSuggestions(["read @hi"], 0, "read @hi".length, {
    signal: controller.signal,
  });

  assert.ok(suggestions);
  assert.deepEqual(
    suggestions.items.map((item) => item.label),
    ["hit.ts"],
  );
});

void test("autocomplete bridge keeps references outside providers registered later", async () => {
  const providers: Array<(current: AutocompleteProvider) => AutocompleteProvider> = [];
  const host = {
    addAutocompleteProvider(factory: (current: AutocompleteProvider) => AutocompleteProvider) {
      providers.push(factory);
    },
  };
  const add = bridgeReferencesAutocomplete({ host, getReferences: () => references });

  add((current) => createReferencesAutocompleteProvider(current, () => references));
  host.addAutocompleteProvider((current) => ({
    async getSuggestions() {
      return {
        prefix: "@op",
        items: [{ value: "@other.ts", label: "other.ts" }],
      };
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },
  }));

  const combined = providers.reduce((current, factory) => factory(current), provider(null));
  const controller = new AbortController();
  const suggestions = await combined.getSuggestions(["read @op"], 0, "read @op".length, {
    signal: controller.signal,
  });

  assert.ok(suggestions);
  assert.deepEqual(
    suggestions.items.map((item) => item.label),
    ["@opencode", "other.ts"],
  );
});

void test("reference invocations render XML blocks with resolved paths", () => {
  const invocations = findReferenceInvocations("compare @opencode. and @missing", references);
  const rendered = renderReferenceInvocation(invocations);

  assert.deepEqual(invocations, [
    {
      name: "opencode",
      token: "@opencode",
      path: "/cache/github.com/anomalyco/opencode",
      description: "OpenCode source",
    },
  ]);
  assert.equal(
    rendered,
    [
      '<reference name="opencode" token="@opencode" path="/cache/github.com/anomalyco/opencode">',
      "The user inserted this project reference with @ autocomplete. Use the resolved path when reading or searching this referenced project.",
      "",
      "OpenCode source",
      "</reference>",
    ].join("\n"),
  );
});

void test("reference path rewrite resolves aliases and rejects path escapes", () => {
  assert.equal(
    rewriteReferencePath("@opencode/packages/core", references),
    "/cache/github.com/anomalyco/opencode/packages/core",
  );
  assert.equal(rewriteReferencePath("@opencode/../secret", references), "@opencode/../secret");
  assert.equal(rewriteReferencePath("./local", references), "./local");
});
