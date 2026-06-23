import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Result } from "better-result";
import { labelExtensionPath, profileStartup } from "../benchmark";

void test("profileStartup times extension load and lifecycle handlers", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-profiler-"));
  const extension = path.join(dir, "slow.js");
  await fs.writeFile(
    extension,
    `export default async function (pi) {
  await new Promise((resolve) => setTimeout(resolve, 5));
  pi.on("session_start", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}
`,
    "utf8",
  );

  try {
    const profiled = await profileStartup({ cwd: dir, paths: [extension], includeLifecycle: true });
    assert.equal(Result.isError(profiled), false);
    if (Result.isError(profiled)) return;

    assert.equal(profiled.value.totals.extensions, 1);
    assert.equal(
      profiled.value.records.some((record) => record.phase === "load"),
      true,
    );
    assert.equal(
      profiled.value.records.some((record) => record.phase === "session_start"),
      true,
    );
    assert.equal(
      profiled.value.records.every((record) => record.status === "ok"),
      true,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

void test("labelExtensionPath compacts node_modules package paths", () => {
  assert.equal(
    labelExtensionPath("/tmp/node_modules/@scope/pkg/dist/extension.js", "/repo"),
    "@scope/pkg",
  );
  assert.equal(labelExtensionPath("/repo/.pi/extensions/foo.js", "/repo"), ".pi/extensions/foo.js");
});
