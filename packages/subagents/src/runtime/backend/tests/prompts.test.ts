import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { getDefaultOhmConfig } from "@pi-ohm/config";
import { buildStartPrompt } from "../prompts";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

function withTempDir(run: (cwd: string) => void | Promise<void>): Promise<void> {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-ohm-prompts-"));
  const result = run(cwd);
  return Promise.resolve(result).finally(() => {
    rmSync(cwd, { recursive: true, force: true });
  });
}

function createStartPromptInput(cwd: string, scaffoldPrompt: string) {
  return {
    taskId: "task_1",
    subagent: {
      id: "finder",
      name: "Finder",
      summary: "Search helper",
      whenToUse: ["Search repo"],
      scaffoldPrompt,
    },
    description: "Trace auth flow",
    prompt: "find token validation",
    config: getDefaultOhmConfig(),
    cwd,
    signal: undefined,
  } as const;
}

defineTest("buildStartPrompt keeps inline scaffold prompt text", async () => {
  const prompt = await buildStartPrompt(createStartPromptInput("/tmp", "Inline scaffold guidance"));

  assert.match(prompt, /Inline scaffold guidance/);
  assert.match(prompt, /Profile scaffold guidance:/);
});

defineTest("buildStartPrompt resolves {file:...} scaffold prompt reference from cwd", async () => {
  await withTempDir(async (cwd) => {
    const promptDir = path.join(cwd, "prompts");
    mkdirSync(promptDir, { recursive: true });
    const promptPath = path.join(promptDir, "finder.gemini.txt");
    writeFileSync(promptPath, "Prompt from file guidance", "utf8");

    const prompt = await buildStartPrompt(
      createStartPromptInput(cwd, "{file:./prompts/finder.gemini.txt}"),
    );

    assert.match(prompt, /Prompt from file guidance/);
    assert.match(prompt, /source: .*finder\.gemini\.txt/);
  });
});
