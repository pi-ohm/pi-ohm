import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveBuiltInSubagentPromptReference } from "../subagent-prompts";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

function withTempDir(run: (dir: string) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-ohm-subagent-prompts-"));
  return Promise.resolve(run(dir)).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}

function parseFileReference(reference: string | undefined): string | undefined {
  if (!reference) return undefined;
  const matched = reference.match(/^\{file:(.+)\}$/u);
  return matched?.[1];
}

defineTest("resolveBuiltInSubagentPromptReference returns an existing built-in prompt file", () => {
  const reference = resolveBuiltInSubagentPromptReference({
    subagentId: "finder",
  });

  const resolvedPath = parseFileReference(reference);
  assert.notEqual(resolvedPath, undefined);
  if (!resolvedPath) {
    assert.fail("Expected built-in prompt file reference");
  }

  assert.equal(resolvedPath.endsWith("finder.general.txt"), true);
});

defineTest(
  "resolveBuiltInSubagentPromptReference resolves prompt files from packaged dist fallback",
  async () => {
    await withTempDir(async (root) => {
      const moduleDir = path.join(root, "dist/runtime/backend");
      const promptDir = path.join(root, "src/runtime/backend/prompts");
      mkdirSync(moduleDir, { recursive: true });
      mkdirSync(promptDir, { recursive: true });
      const defaultPromptPath = path.join(promptDir, "finder.general.txt");
      writeFileSync(defaultPromptPath, "Finder general", "utf8");

      const reference = resolveBuiltInSubagentPromptReference({
        subagentId: "finder",
        moduleDir,
      });

      const resolvedPath = parseFileReference(reference);
      assert.equal(resolvedPath, defaultPromptPath);
    });
  },
);

defineTest(
  "resolveBuiltInSubagentPromptReference returns undefined when no prompt files exist",
  async () => {
    await withTempDir(async (root) => {
      const moduleDir = path.join(root, "dist/runtime/backend");
      mkdirSync(moduleDir, { recursive: true });

      const reference = resolveBuiltInSubagentPromptReference({
        subagentId: "finder",
        moduleDir,
      });

      assert.equal(reference, undefined);
    });
  },
);
