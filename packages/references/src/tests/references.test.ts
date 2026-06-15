import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mergeReferencesConfig } from "../config";
import { renderReferenceGuidance, resolveConfiguredReferences } from "../references";

void test("merges valid aliases and ignores invalid aliases", () => {
  const config = mergeReferencesConfig(undefined, {
    docs: { path: "../docs", description: "Use docs" },
    "bad alias": "owner/repo",
    sdk: { repository: "owner/repo", branch: "main", hidden: true },
  });

  assert.deepEqual(Object.keys(config).sort(), ["docs", "sdk"]);
});

void test("resolves local and git references deterministically", () => {
  const cwd = path.join(path.sep, "repo", "app");
  const resolved = resolveConfiguredReferences({
    cwd,
    cacheRoot: path.join(path.sep, "cache"),
    config: {
      docs: { path: "../docs", description: "Use docs" },
      sdk: { repository: "owner/repo", branch: "main", description: "Use SDK", hidden: true },
      shorthand: "./examples",
      bad: "not-a-repo",
    },
  });

  assert.equal(resolved.diagnostics.length, 1);
  assert.equal(resolved.references.length, 3);
  assert.equal(resolved.references[0]?.path, path.join(path.sep, "repo", "docs"));
  assert.equal(
    resolved.references[1]?.path,
    path.join(path.sep, "cache", "github.com", "owner", "repo"),
  );
  assert.equal(resolved.references[1]?.hidden, true);
  assert.equal(resolved.references[2]?.path, path.join(path.sep, "repo", "app", "examples"));
});

void test("renders guidance only for described references sorted by alias", () => {
  const resolved = resolveConfiguredReferences({
    cwd: "/repo",
    cacheRoot: "/cache",
    config: {
      zed: "./zed",
      sdk: { repository: "owner/repo", description: "Use SDK" },
      docs: { path: "./docs", description: "Use docs" },
    },
  });
  const guidance = renderReferenceGuidance(resolved.references);

  assert.ok(guidance);
  assert.match(guidance, /<available_references>/);
  assert.ok(guidance.indexOf("<name>docs</name>") < guidance.indexOf("<name>sdk</name>"));
  assert.equal(guidance.includes("<name>zed</name>"), false);
});
