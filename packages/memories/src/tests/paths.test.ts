import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Result } from "better-result";
import { readSummary } from "../layout";
import { resolveMemoryPaths } from "../paths";

void test("resolveMemoryPaths uses XDG_DATA_HOME", () => {
  const paths = resolveMemoryPaths({ XDG_DATA_HOME: "/tmp/data" });
  assert.equal(paths.state, "/tmp/data/pi-ohm/memories/state.sqlite");
});

void test("resolveMemoryPaths falls back to ~/.local/share/pi-ohm/memories/state.sqlite", () => {
  const paths = resolveMemoryPaths({});
  assert.equal(
    paths.state,
    path.join(os.homedir(), ".local", "share", "pi-ohm", "memories", "state.sqlite"),
  );
});

void test("readSummary treats missing summary as empty", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-memories-paths-"));
  const paths = resolveMemoryPaths({ XDG_DATA_HOME: dir });
  const summary = await readSummary(paths, 100);
  await fs.rm(dir, { recursive: true, force: true });

  assert.equal(Result.isOk(summary), true);
  if (Result.isError(summary)) assert.fail(summary.error.message);
  assert.equal(summary.value, undefined);
});
