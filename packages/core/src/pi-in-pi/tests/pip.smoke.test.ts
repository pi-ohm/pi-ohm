import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Result } from "better-result";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getModels, getProviders, type Api, type Model } from "@earendil-works/pi-ai";
import {
  createSdkPipRunner,
  extractPipParentEntries,
  PipController,
  resolvePipSessionFile,
} from "../index";

const shouldRunModel = process.env.PI_OHM_RUN_PIP_SMOKE_TEST === "true";
const defaultSmokeModel = "openai-codex/gpt-5.4-mini:medium";

void test("PiP SDK smoke: creates a real persisted Pi child session path without model IO", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-pip-smoke-cwd-"));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-pip-smoke-data-"));
  const entries: unknown[] = [];
  const controller = new PipController({
    runner: createSdkPipRunner({ dataDir, noTools: "all" }),
    createId: () => "pip-smoke-no-model",
    entries: {
      write(entry) {
        entries.push({ type: "custom", customType: "pi-ohm.pip", data: entry });
        return Result.ok("entry-smoke");
      },
    },
  });

  const spawned = await controller.spawn({
    ownerPackage: "@pi-ohm/core/tests",
    role: "smoke-test",
    parentSessionId: "parent-smoke",
    cwd,
  });

  assert.equal(Result.isOk(spawned), true);
  if (Result.isError(spawned)) assert.fail(spawned.error.message);
  assert.equal(spawned.value.pipId, "pip-smoke-no-model");
  assert.equal(spawned.value.childSessionPath?.endsWith(".jsonl"), true);
  assert.match(spawned.value.childSessionPath ?? "", /^sessions\//);

  const file = resolvePipSessionFile({
    dataDir,
    childSessionPath: spawned.value.childSessionPath ?? "",
  });
  assert.equal(Result.isOk(file), true);
  if (Result.isError(file)) assert.fail(file.error.message);
  assert.match(file.value, /pip-smoke-no-model/);
  const siblings = await fs.readdir(path.dirname(file.value));
  assert.equal(
    siblings.some((entry) => entry.endsWith(".json") && !entry.endsWith(".jsonl")),
    false,
  );

  const parsed = extractPipParentEntries(entries);
  assert.equal(Result.isOk(parsed), true);
  if (Result.isError(parsed)) assert.fail(parsed.error.message);
  assert.deepEqual(
    parsed.value.map((entry) => entry.kind),
    ["pip_spawn_requested", "pip_spawned"],
  );
});

void test("PiP SDK smoke: configurable real model", { skip: !shouldRunModel }, async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-pip-model-smoke-cwd-"));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-pip-model-smoke-data-"));
  const modelSpec = parseSmokeModelSpec(process.env.PI_OHM_PIP_SMOKE_MODEL ?? defaultSmokeModel);
  const controller = new PipController({
    runner: createSdkPipRunner({
      dataDir,
      model: modelSpec.model,
      thinkingLevel: modelSpec.thinkingLevel,
      noTools: "all",
    }),
    createId: () => "pip-smoke-model",
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
  assert.equal(spawned.value.pipId, "pip-smoke-model");
  assert.equal(spawned.value.childSessionId.length > 0, true);
  assert.equal(spawned.value.childSessionPath?.endsWith(".jsonl"), true);
  assert.equal(spawned.value.status.state, "completed");

  const closed = await controller.close({ pipId: spawned.value.pipId });
  assert.equal(Result.isOk(closed), true);
  if (Result.isError(closed)) assert.fail(closed.error.message);
});

function parseSmokeModelSpec(input: string): {
  readonly model: Model<Api>;
  readonly thinkingLevel: ThinkingLevel;
} {
  const slash = input.indexOf("/");
  const colon = input.lastIndexOf(":");
  const provider = input.slice(0, slash).trim();
  const modelId = input.slice(slash + 1, colon > slash ? colon : undefined).trim();
  const thinkingLevel = parseThinkingLevel(colon > slash ? input.slice(colon + 1) : "medium");
  const knownProvider = getProviders().find((candidate) => candidate === provider);
  if (!knownProvider) throw new Error(`Unknown smoke model provider '${provider}'`);

  const model = getModels(knownProvider).find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Unknown smoke model '${provider}/${modelId}'`);

  return { model, thinkingLevel };
}

function parseThinkingLevel(input: string): ThinkingLevel {
  const level = input.trim().toLowerCase();
  if (level === "off") return "off";
  if (level === "minimal") return "minimal";
  if (level === "low") return "low";
  if (level === "medium") return "medium";
  if (level === "high") return "high";
  if (level === "xhigh") return "xhigh";
  throw new Error(`Unknown smoke thinking level '${input}'`);
}
