import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Result } from "better-result";
import { getModel } from "@earendil-works/pi-ai";
import { createInMemoryPipGraphStore, createSdkPipRunner, PipController } from "../index";

const shouldRun = process.env.PI_OHM_RUN_PIP_SMOKE_TEST === "true";

void test("PiP SDK smoke: openai-codex/gpt-5.4-mini", { skip: !shouldRun }, async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-pip-smoke-"));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-pip-sessions-"));
  const controller = new PipController({
    runner: createSdkPipRunner({
      sessionDir,
      model: getModel("openai-codex", "gpt-5.4-mini"),
      thinkingLevel: "minimal",
      noTools: "all",
    }),
    graph: createInMemoryPipGraphStore(),
    createId: () => "pip-smoke",
  });

  const spawned = await controller.spawn({
    ownerPackage: "@pi-ohm/core/tests",
    role: "smoke-test",
    parentSessionId: "parent-smoke",
    cwd,
    prompt: "Reply with exactly PIP_SMOKE_OK and no other text.",
  });

  assert.equal(Result.isOk(spawned), true);
  if (Result.isError(spawned)) assert.fail(spawned.error.message);
  assert.equal(spawned.value.pipId, "pip-smoke");
  assert.equal(spawned.value.childSessionId.length > 0, true);
  assert.equal(spawned.value.childSessionFile?.endsWith(".jsonl"), true);
  assert.equal(spawned.value.status.state, "completed");

  const closed = await controller.close({ pipId: spawned.value.pipId });
  assert.equal(Result.isOk(closed), true);
  if (Result.isError(closed)) assert.fail(closed.error.message);
});
