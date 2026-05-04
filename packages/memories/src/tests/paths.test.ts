import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
